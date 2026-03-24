/**
 * SQL statement splitting with full MySQL DELIMITER support.
 * Reusable utility for query editor and stored procedure editors.
 */

export interface StatementRange {
  /** Start character offset (inclusive) */
  start: number
  /** End character offset (exclusive) */
  end: number
  /** The SQL text of this statement (trimmed) */
  sql: string
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
