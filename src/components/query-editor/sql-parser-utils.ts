const BACKSLASH_ESCAPE_LENGTH = 2
const BLOCK_COMMENT_DELIMITER_LENGTH = 2

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
  let position = 0

  // Skip whitespace at start
  while (position < sql.length && /\s/.test(sql[position])) position++
  let statementStart = position

  while (position < sql.length) {
    // Skip string literals
    if (sql[position] === "'" || sql[position] === '"' || sql[position] === '`') {
      const quote = sql[position]
      position++
      while (position < sql.length) {
        if (sql[position] === '\\') {
          position += BACKSLASH_ESCAPE_LENGTH
          continue
        }
        if (sql[position] === quote) {
          position++
          break
        }
        position++
      }
      continue
    }

    // Skip block comments (non-executable: /* ... */)
    if (position + 1 < sql.length && sql[position] === '/' && sql[position + 1] === '*') {
      // Check if executable comment — still skip for splitting purposes
      position += BLOCK_COMMENT_DELIMITER_LENGTH
      while (position + 1 < sql.length && !(sql[position] === '*' && sql[position + 1] === '/')) {
        position++
      }
      position += BLOCK_COMMENT_DELIMITER_LENGTH
      continue
    }

    // Skip line comments -- ...
    if (position + 1 < sql.length && sql[position] === '-' && sql[position + 1] === '-') {
      while (position < sql.length && sql[position] !== '\n') position++
      continue
    }

    // Skip # comments
    if (sql[position] === '#') {
      while (position < sql.length && sql[position] !== '\n') position++
      continue
    }

    // Check for DELIMITER directive only at start of content or start of a new line
    // (never inside a string literal or comment, which are already skipped above)
    const isLineStart = position === 0 || sql[position - 1] === '\n'
    if (isLineStart) {
      const remaining = sql.slice(position)
      const delimMatch = remaining.match(/^DELIMITER\s+(\S+)/i)
      if (delimMatch) {
        // Push any pending statement before the DELIMITER line
        const pending = sql.slice(statementStart, position).trim()
        if (pending) {
          results.push({ start: statementStart, end: position, sql: pending })
        }
        delimiter = delimMatch[1]
        const delimLineEnd = sql.indexOf('\n', position)
        position = delimLineEnd === -1 ? sql.length : delimLineEnd + 1
        statementStart = position
        continue
      }
    }

    // Check for current delimiter
    if (sql.startsWith(delimiter, position)) {
      const statementEnd = position + delimiter.length
      const statement = sql.slice(statementStart, position).trim()
      if (statement) {
        results.push({ start: statementStart, end: statementEnd, sql: statement })
      }
      position = statementEnd
      // Skip whitespace
      while (position < sql.length && /\s/.test(sql[position])) position++
      statementStart = position
      continue
    }

    position++
  }

  // Handle trailing statement without delimiter
  const trailing = sql.slice(statementStart).trim()
  if (trailing) {
    results.push({ start: statementStart, end: sql.length, sql: trailing })
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
  for (const statement of statements) {
    if (statement.start <= cursorOffset && cursorOffset <= statement.end) {
      best = statement
      break
    }
    if (statement.start <= cursorOffset) {
      best = statement
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
