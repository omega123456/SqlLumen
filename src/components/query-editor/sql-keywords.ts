/**
 * Centralised SQL keyword lists.
 *
 * - `SQL_KEYWORDS` — uppercase keyword strings used for fallback completions.
 * - `SQL_RESERVED_WORDS_SET` — lowercase Set used to filter out reserved words
 *   that cannot be table aliases.  Derived from SQL_KEYWORDS plus a handful of
 *   additional reserved words needed by the alias resolver.
 */

// ---------------------------------------------------------------------------
// Keyword list (uppercase — used for completion items)
// ---------------------------------------------------------------------------

export const SQL_KEYWORDS: readonly string[] = [
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'OUTER',
  'ON',
  'AND',
  'OR',
  'NOT',
  'IN',
  'BETWEEN',
  'LIKE',
  'IS',
  'NULL',
  'AS',
  'ORDER',
  'BY',
  'GROUP',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'INSERT',
  'INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE',
  'CREATE',
  'ALTER',
  'DROP',
  'TABLE',
  'INDEX',
  'VIEW',
  'DATABASE',
  'USE',
  'SHOW',
  'DESCRIBE',
  'EXPLAIN',
  'DISTINCT',
  'ALL',
  'UNION',
  'EXISTS',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'COALESCE',
  'IFNULL',
  'ASC',
  'DESC',
  'PRIMARY',
  'KEY',
  'FOREIGN',
  'REFERENCES',
  'CONSTRAINT',
  'DEFAULT',
  'AUTO_INCREMENT',
  'UNIQUE',
  'WITH',
] as const

// ---------------------------------------------------------------------------
// Reserved-word Set (lowercase — used by alias resolver to reject aliases
// that are actually SQL keywords)
// ---------------------------------------------------------------------------

/**
 * Additional reserved words that the alias resolver needs to reject but
 * that are not in the main SQL_KEYWORDS completion list.
 */
const EXTRA_RESERVED_WORDS: readonly string[] = [
  'cross',
  'natural',
  'using',
  'force',
  'ignore',
  'straight_join',
  'partition',
]

export const SQL_RESERVED_WORDS_SET: ReadonlySet<string> = new Set([
  ...SQL_KEYWORDS.map((k) => k.toLowerCase()),
  ...EXTRA_RESERVED_WORDS,
])
