/**
 * SQL statement splitting with full MySQL DELIMITER support.
 * Reusable utility for query editor and stored procedure editors.
 */

import { Parser } from 'node-sql-parser/build/mysql'

export interface StatementRange {
  /** Start character offset (inclusive) */
  start: number
  /** End character offset (exclusive) */
  end: number
  /** The SQL text of this statement (trimmed) */
  sql: string
}

export interface CursorContext {
  type: 'select-columns' | 'from-clause' | 'where-clause' | 'join-clause' | 'generic' | 'unknown'
  /** Database name if detected */
  database?: string
  /** Table name if detected (for column context) */
  table?: string
}

/** Singleton parser instance to avoid repeated construction. */
let _parser: Parser | null = null

function getParser(): Parser {
  if (!_parser) {
    _parser = new Parser()
  }
  return _parser
}

/**
 * Split SQL content into individual statements, supporting:
 * - Standard semicolon delimiters
 * - MySQL DELIMITER changes (DELIMITER $$, DELIMITER //, etc.)
 * - BEGIN...END blocks (stored routines)
 * - String literal awareness (no splitting inside strings)
 * - Comment awareness (no splitting inside comments)
 */
export function splitStatements(sql: string): StatementRange[] {
  const results: StatementRange[] = []
  let delimiter = ';'
  let pos = 0

  // Skip whitespace at start
  while (pos < sql.length && /\s/.test(sql[pos])) pos++
  let stmtStart = pos

  while (pos < sql.length) {
    // Skip string literals
    if (sql[pos] === "'" || sql[pos] === '"' || sql[pos] === '`') {
      const quote = sql[pos]
      pos++
      while (pos < sql.length) {
        if (sql[pos] === '\\') {
          pos += 2
          continue
        }
        if (sql[pos] === quote) {
          pos++
          break
        }
        pos++
      }
      continue
    }

    // Skip block comments (non-executable: /* ... */)
    if (pos + 1 < sql.length && sql[pos] === '/' && sql[pos + 1] === '*') {
      // Check if executable comment — still skip for splitting purposes
      pos += 2
      while (pos + 1 < sql.length && !(sql[pos] === '*' && sql[pos + 1] === '/')) {
        pos++
      }
      pos += 2 // skip */
      continue
    }

    // Skip line comments -- ...
    if (pos + 1 < sql.length && sql[pos] === '-' && sql[pos + 1] === '-') {
      while (pos < sql.length && sql[pos] !== '\n') pos++
      continue
    }

    // Skip # comments
    if (sql[pos] === '#') {
      while (pos < sql.length && sql[pos] !== '\n') pos++
      continue
    }

    // Check for DELIMITER directive only at start of content or start of a new line
    // (never inside a string literal or comment, which are already skipped above)
    const isLineStart = pos === 0 || sql[pos - 1] === '\n'
    if (isLineStart) {
      const remaining = sql.slice(pos)
      const delimMatch = remaining.match(/^DELIMITER\s+(\S+)/i)
      if (delimMatch) {
        // Push any pending statement before the DELIMITER line
        const pending = sql.slice(stmtStart, pos).trim()
        if (pending) {
          results.push({ start: stmtStart, end: pos, sql: pending })
        }
        delimiter = delimMatch[1]
        const delimLineEnd = sql.indexOf('\n', pos)
        pos = delimLineEnd === -1 ? sql.length : delimLineEnd + 1
        stmtStart = pos
        continue
      }
    }

    // Check for current delimiter
    if (sql.startsWith(delimiter, pos)) {
      const stmtEnd = pos + delimiter.length
      const stmt = sql.slice(stmtStart, pos).trim()
      if (stmt) {
        results.push({ start: stmtStart, end: stmtEnd, sql: stmt })
      }
      pos = stmtEnd
      // Skip whitespace
      while (pos < sql.length && /\s/.test(sql[pos])) pos++
      stmtStart = pos
      continue
    }

    pos++
  }

  // Handle trailing statement without delimiter
  const trailing = sql.slice(stmtStart).trim()
  if (trailing) {
    results.push({ start: stmtStart, end: sql.length, sql: trailing })
  }

  return results
}

/**
 * Find the statement that contains the given cursor offset.
 * Returns null if no statement contains the cursor.
 */
export function findStatementAtCursor(
  statements: StatementRange[],
  cursorOffset: number
): StatementRange | null {
  // Find the last statement whose start <= cursor
  let best: StatementRange | null = null
  for (const stmt of statements) {
    if (stmt.start <= cursorOffset && cursorOffset <= stmt.end) {
      best = stmt
      break
    }
    if (stmt.start <= cursorOffset) {
      best = stmt
    }
  }
  return best
}

/**
 * Convert (line, column) cursor position (1-indexed) to a character offset in the text.
 */
export function cursorToOffset(sql: string, line: number, column: number): number {
  let offset = 0
  let currentLine = 1
  while (currentLine < line && offset < sql.length) {
    if (sql[offset] === '\n') currentLine++
    offset++
  }
  return offset + column - 1
}

/**
 * Detect autocomplete context from cursor position in SQL using AST (with regex fallback).
 * Returns context type and relevant database/table names.
 */
export function detectCursorContext(sql: string, cursorOffset: number): CursorContext {
  // Try AST-based detection first
  const astResult = detectCursorContextAST(sql, cursorOffset)
  if (astResult) return astResult

  // Fallback to regex-based detection
  return detectCursorContextRegex(sql, cursorOffset)
}

/**
 * AST-based context detection. Parses SQL up to the cursor with node-sql-parser.
 * Returns null if parsing fails (incomplete SQL, syntax error, etc.).
 */
function detectCursorContextAST(sql: string, cursorOffset: number): CursorContext | null {
  const sqlBefore = sql.slice(0, cursorOffset)
  // Try to parse — for incomplete SQL, append a placeholder to make it parseable
  const variants = [
    sqlBefore, // exact text up to cursor
    sqlBefore + ' __placeholder__', // adds a word to incomplete clauses
    sqlBefore + ' __placeholder__ FROM __t__', // for incomplete SELECT
  ]

  for (const variant of variants) {
    try {
      const parser = getParser()
      const ast = parser.astify(variant, { database: 'MySQL' })
      const result = extractContextFromAST(ast, sqlBefore)
      if (result) return result
    } catch {
      // Parsing failed — try next variant
    }
  }

  return null
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Walk the AST to determine cursor context.
 * Returns a CursorContext or null if context can't be determined.
 */
function extractContextFromAST(ast: any, sqlBefore: string): CursorContext | null {
  const stmts: any[] = Array.isArray(ast) ? ast : [ast]
  // Use the last statement (closest to cursor)
  const stmt = stmts[stmts.length - 1]
  if (!stmt || typeof stmt !== 'object') return null

  const stmtType = (stmt.type ?? '').toString().toUpperCase()

  if (stmtType === 'SELECT') {
    // Check if we have FROM tables
    const fromTables = extractTablesFromAST(stmt)
    const upperBefore = sqlBefore.toUpperCase()

    // Determine which clause the cursor is in using keyword position analysis
    const lastSelect = upperBefore.lastIndexOf('SELECT')
    const lastFrom = upperBefore.lastIndexOf('FROM')
    const lastWhere = upperBefore.lastIndexOf('WHERE')
    const lastJoin = upperBefore.lastIndexOf('JOIN')
    const lastHaving = upperBefore.lastIndexOf('HAVING')
    const lastOn = upperBefore.lastIndexOf(' ON ')

    const maxKeyword = Math.max(lastWhere, lastHaving, lastOn, lastJoin, lastFrom, lastSelect)

    if (maxKeyword === lastWhere || maxKeyword === lastHaving || maxKeyword === lastOn) {
      return {
        type: 'where-clause',
        table: fromTables.length > 0 ? fromTables[0].table : undefined,
      }
    }

    if (maxKeyword === lastJoin) {
      return { type: 'from-clause' }
    }

    if (maxKeyword === lastFrom) {
      // Check if cursor is right after FROM (still in FROM clause)
      // or if we've moved past the table name into something else
      const afterFrom = sqlBefore.slice(lastFrom + 4).trim()
      // If there's a comma or we're still typing a table name, it's from-clause
      if (!afterFrom || /^[\w.`"]*$/.test(afterFrom) || afterFrom.endsWith(',')) {
        const dbMatch = afterFrom.match(/^(\w+)\.\s*\w*$/)
        return {
          type: 'from-clause',
          database: dbMatch ? dbMatch[1].toLowerCase() : undefined,
        }
      }
      return { type: 'from-clause' }
    }

    if (maxKeyword === lastSelect && lastFrom === -1) {
      // We're in SELECT columns (no FROM yet)
      return { type: 'select-columns' }
    }

    if (lastFrom > lastSelect && (lastWhere < lastFrom || lastWhere === -1)) {
      // After FROM but not yet in WHERE — could be in FROM clause still
      return { type: 'from-clause' }
    }

    return { type: 'select-columns' }
  }

  // For non-SELECT statements, return generic
  return { type: 'generic' }
}

/**
 * Extract table references from a SELECT AST node.
 */
function extractTablesFromAST(stmt: any): Array<{ table: string; database?: string }> {
  const tables: Array<{ table: string; database?: string }> = []

  if (stmt.from && Array.isArray(stmt.from)) {
    for (const fromItem of stmt.from) {
      if (fromItem.table) {
        tables.push({
          table: fromItem.table,
          database: fromItem.db ?? undefined,
        })
      }
    }
  }

  return tables
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Regex-based fallback context detection.
 */
function detectCursorContextRegex(sql: string, cursorOffset: number): CursorContext {
  const before = sql.slice(0, cursorOffset).toUpperCase()

  // After FROM or JOIN — table context
  if (/\b(FROM|JOIN)\s+\S*$/.test(before)) {
    // Try to extract database from "db."
    const dbMatch = before.match(/\b(FROM|JOIN)\s+([A-Z0-9_]+)\.\s*\S*$/)
    return {
      type: 'from-clause',
      database: dbMatch ? dbMatch[2].toLowerCase() : undefined,
    }
  }

  // After SELECT or commas in SELECT list — column context
  if (/\bSELECT\s+([^;]*)$/.test(before) && !/\bFROM\b/.test(before)) {
    return { type: 'select-columns' }
  }

  // After WHERE, HAVING, ON — column context
  if (/\b(WHERE|HAVING|ON)\s+\S*$/.test(before)) {
    // Try to find the table reference
    const tableMatch = before.match(/\bFROM\s+([A-Z0-9_]+)/i)
    return {
      type: 'where-clause',
      table: tableMatch ? tableMatch[1].toLowerCase() : undefined,
    }
  }

  // Generic context
  return { type: 'generic' }
}
