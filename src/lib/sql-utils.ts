/**
 * Shared SQL parsing utilities used by query-store and query-edit-utils.
 *
 * These are pure functions with no side effects or external dependencies.
 */

/**
 * Strip leading SQL comments (block, line `-- ...`, and `# ...`)
 * so we can identify the first real keyword.
 *
 * Supports nested block comments (`/* outer /* inner *​/ still outer *​/`).
 *
 * Preserves MySQL executable comments (`/​*! ... *​/`) and optimizer hints
 * (`/​*+ ... *​/`). These are treated as part of the SQL statement.
 */
export function stripLeadingSqlComments(sql: string): string {
  let s = sql

  while (true) {
    s = s.trimStart()
    if (s.startsWith('/*')) {
      // Check if it's a MySQL executable comment (/*! or /*+) — preserve it
      if (s.length > 2 && (s[2] === '!' || s[2] === '+')) {
        break
      }
      // Standard block comment — find the matching close. Support nested /* ... */
      let depth = 0
      let i = 0
      while (i < s.length) {
        if (s[i] === '/' && s[i + 1] === '*') {
          depth++
          i += 2
        } else if (s[i] === '*' && s[i + 1] === '/') {
          depth--
          i += 2
          if (depth === 0) break
        } else {
          i++
        }
      }
      s = s.slice(i)
    } else if (s.startsWith('--')) {
      // Line comment (-- style)
      const newlineIdx = s.indexOf('\n')
      s = newlineIdx === -1 ? '' : s.slice(newlineIdx + 1)
    } else if (s.startsWith('#')) {
      // Line comment (# style)
      const newlineIdx = s.indexOf('\n')
      s = newlineIdx === -1 ? '' : s.slice(newlineIdx + 1)
    } else {
      break
    }
  }
  return s
}

/**
 * Extract the first SQL keyword from a string after stripping leading comments.
 * Returns the keyword uppercased, or '' if none found.
 *
 * Handles MySQL executable comments (e.g. `/*!50001 CALL proc() *​/`).
 */
export function getFirstSqlKeyword(sql: string): string {
  const stripped = stripLeadingSqlComments(sql).trimStart()

  // Handle executable comments: /*!<optional-version-digits> keyword ... */
  if (stripped.startsWith('/*!')) {
    const inner = stripped.slice(3) // strip /*!
    // Skip optional version number (digits)
    const afterVersion = inner.replace(/^\d+/, '')
    const afterWs = afterVersion.trimStart()
    // Extract first word
    const match = afterWs.match(/^[a-zA-Z_]\w*/)
    if (match) {
      return match[0].toUpperCase()
    }
  }

  return stripped.split(/\s+/)[0]?.toUpperCase() ?? ''
}
