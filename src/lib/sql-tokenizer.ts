/**
 * SQL tokenizer — CSS-based syntax highlighting, no library dependency.
 * Produces an array of typed token segments for rendering as React <span> elements.
 */

export type TokenType = 'keyword' | 'string' | 'identifier' | 'comment' | 'number' | 'plain'

export interface Token {
  type: TokenType
  text: string
}

const SQL_KEYWORDS = new Set([
  'CREATE',
  'TABLE',
  'VIEW',
  'PROCEDURE',
  'FUNCTION',
  'TRIGGER',
  'EVENT',
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'FROM',
  'WHERE',
  'NOT',
  'NULL',
  'DEFAULT',
  'AUTO_INCREMENT',
  'ENGINE',
  'CHARSET',
  'COLLATE',
  'INDEX',
  'KEY',
  'PRIMARY',
  'UNIQUE',
  'CONSTRAINT',
  'REFERENCES',
  'ON',
  'AS',
  'BEGIN',
  'END',
  'RETURNS',
  'RETURN',
  'DECLARE',
  'SET',
  'IF',
  'THEN',
  'ELSE',
  'CALL',
  'FOR',
  'EACH',
  'ROW',
])

/** Tokenize a DDL string into typed segments for syntax highlighting. */
export function tokenizeSql(sql: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < sql.length) {
    // Block comment: /* ... */
    if (sql[i] === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      const commentEnd = end === -1 ? sql.length : end + 2
      tokens.push({ type: 'comment', text: sql.slice(i, commentEnd) })
      i = commentEnd
      continue
    }

    // Line comment: -- ...
    if (sql[i] === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      const commentEnd = end === -1 ? sql.length : end
      tokens.push({ type: 'comment', text: sql.slice(i, commentEnd) })
      i = commentEnd
      continue
    }

    // String literal: '...'
    if (sql[i] === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2 // escaped single quote
        } else if (sql[j] === "'") {
          j++
          break
        } else {
          j++
        }
      }
      tokens.push({ type: 'string', text: sql.slice(i, j) })
      i = j
      continue
    }

    // Backtick identifier: `...`
    if (sql[i] === '`') {
      const end = sql.indexOf('`', i + 1)
      const identEnd = end === -1 ? sql.length : end + 1
      tokens.push({ type: 'identifier', text: sql.slice(i, identEnd) })
      i = identEnd
      continue
    }

    // Number: digits (optionally with decimal point)
    if (/\d/.test(sql[i])) {
      let j = i
      while (j < sql.length && /[\d.]/.test(sql[j])) j++
      // Only mark as number if it's not part of a word
      if (i === 0 || !/\w/.test(sql[i - 1])) {
        tokens.push({ type: 'number', text: sql.slice(i, j) })
        i = j
        continue
      }
    }

    // Word (potential keyword)
    if (/[a-zA-Z_]/.test(sql[i])) {
      let j = i
      while (j < sql.length && /[a-zA-Z0-9_]/.test(sql[j])) j++
      const word = sql.slice(i, j)
      if (SQL_KEYWORDS.has(word.toUpperCase())) {
        tokens.push({ type: 'keyword', text: word })
      } else {
        tokens.push({ type: 'plain', text: word })
      }
      i = j
      continue
    }

    // Whitespace and other characters — accumulate as plain text
    let j = i
    while (
      j < sql.length &&
      !/[a-zA-Z_`'\d]/.test(sql[j]) &&
      !(sql[j] === '/' && sql[j + 1] === '*') &&
      !(sql[j] === '-' && sql[j + 1] === '-')
    ) {
      j++
    }
    if (j === i) j = i + 1 // ensure progress
    tokens.push({ type: 'plain', text: sql.slice(i, j) })
    i = j
  }

  return tokens
}
