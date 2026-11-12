export const MYSQL_IDENTIFIER_MAX_LENGTH = 64

const BLOCK_COMMENT_OPEN = '/*'
const EXECUTABLE_COMMENT_OPEN = '/*!'
const BLOCK_COMMENT_DELIMITER_LENGTH = 2
const EXECUTABLE_COMMENT_MARKERS = new Set(['!', '+'])

/**
 * Shared SQL parsing utilities used by query-store and query-edit-utils.
 *
 * These are pure functions with no side effects or external dependencies.
 */

/**
 * Strip leading SQL comments (block, line `-- ...`, and `# ...`)
 * so we can identify the first real keyword.
 *
 * Supports nested block comments, including nested inner/outer block-comment pairs.
 *
 * Preserves MySQL executable comments (`/*! ... *\/`) and optimizer hints
 * (`/*+ ... *\/`). These are treated as part of the SQL statement.
 */
export function stripLeadingSqlComments(sql: string): string {
  let remaining = sql

  while (true) {
    remaining = remaining.trimStart()
    if (remaining.startsWith(BLOCK_COMMENT_OPEN)) {
      const markerAfterOpen = remaining[BLOCK_COMMENT_OPEN.length]
      if (EXECUTABLE_COMMENT_MARKERS.has(markerAfterOpen)) {
        break
      }
      // Standard block comment — find the matching close. Support nested /* ... */
      let depth = 0
      let scanIndex = 0
      while (scanIndex < remaining.length) {
        if (remaining[scanIndex] === '/' && remaining[scanIndex + 1] === '*') {
          depth++
          scanIndex += BLOCK_COMMENT_DELIMITER_LENGTH
        } else if (remaining[scanIndex] === '*' && remaining[scanIndex + 1] === '/') {
          depth--
          scanIndex += BLOCK_COMMENT_DELIMITER_LENGTH
          if (depth === 0) break
        } else {
          scanIndex++
        }
      }
      remaining = remaining.slice(scanIndex)
    } else if (remaining.startsWith('--')) {
      // Line comment (-- style)
      const newlineIndex = remaining.indexOf('\n')
      remaining = newlineIndex === -1 ? '' : remaining.slice(newlineIndex + 1)
    } else if (remaining.startsWith('#')) {
      // Line comment (# style)
      const newlineIndex = remaining.indexOf('\n')
      remaining = newlineIndex === -1 ? '' : remaining.slice(newlineIndex + 1)
    } else {
      break
    }
  }
  return remaining
}

/**
 * Extract the first SQL keyword from a string after stripping leading comments.
 * Returns the keyword uppercased, or '' if none found.
 *
 * Handles MySQL executable comments (e.g. `/*!50001 CALL proc() *\/`).
 */
export function getFirstSqlKeyword(sql: string): string {
  const stripped = stripLeadingSqlComments(sql).trimStart()

  // Handle executable comments: /*!<optional-version-digits> keyword ... */
  if (stripped.startsWith(EXECUTABLE_COMMENT_OPEN)) {
    const inner = stripped.slice(EXECUTABLE_COMMENT_OPEN.length)
    // Skip optional version number (digits)
    const afterVersion = inner.replace(/^\d+/, '')
    const afterWhitespace = afterVersion.trimStart()
    // Extract first word
    const match = afterWhitespace.match(/^[a-zA-Z_]\w*/)
    if (match) {
      return match[0].toUpperCase()
    }
  }

  return stripped.split(/\s+/)[0]?.toUpperCase() ?? ''
}
