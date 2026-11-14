export const MYSQL_IDENTIFIER_MAX_LENGTH = 64

const BLOCK_COMMENT_OPEN = '/*'
const BLOCK_COMMENT_CLOSE = '*/'
const EXECUTABLE_COMMENT_OPEN = '/*!'
const BLOCK_COMMENT_DELIMITER_LENGTH = 2
const EXECUTABLE_COMMENT_MARKERS = new Set(['!', '+'])
const LINE_COMMENT_PREFIXES = ['--', '#'] as const

/**
 * Shared SQL parsing utilities used by query-store and query-edit-utils.
 *
 * These are pure functions with no side effects or external dependencies.
 */

function blockCommentEndIndex(text: string): number {
  let depth = 0
  let scanIndex = 0
  while (scanIndex < text.length) {
    const pair = text.slice(scanIndex, scanIndex + BLOCK_COMMENT_DELIMITER_LENGTH)
    if (pair === BLOCK_COMMENT_OPEN) {
      depth++
      scanIndex += BLOCK_COMMENT_DELIMITER_LENGTH
      continue
    }
    const isOutermostClose = pair === BLOCK_COMMENT_CLOSE && depth === 1
    if (isOutermostClose) {
      return scanIndex + BLOCK_COMMENT_DELIMITER_LENGTH
    }
    if (pair === BLOCK_COMMENT_CLOSE) {
      depth--
      scanIndex += BLOCK_COMMENT_DELIMITER_LENGTH
      continue
    }
    scanIndex++
  }
  return scanIndex
}

function textAfterFirstLine(text: string): string {
  const newlineIndex = text.indexOf('\n')
  return newlineIndex === -1 ? '' : text.slice(newlineIndex + 1)
}

function stripOneLeadingComment(text: string): string | null {
  if (text.startsWith(BLOCK_COMMENT_OPEN)) {
    const markerAfterOpen = text[BLOCK_COMMENT_OPEN.length]
    if (EXECUTABLE_COMMENT_MARKERS.has(markerAfterOpen)) return null
    return text.slice(blockCommentEndIndex(text))
  }
  if (startsWithLineComment(text)) return textAfterFirstLine(text)
  return null
}

function startsWithLineComment(text: string): boolean {
  return LINE_COMMENT_PREFIXES.some((prefix) => text.startsWith(prefix))
}

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
  let remaining = sql.trimStart()
  while (true) {
    const stripped = stripOneLeadingComment(remaining)
    if (stripped === null) return remaining
    remaining = stripped.trimStart()
  }
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
