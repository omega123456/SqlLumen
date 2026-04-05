/**
 * Monaco signature help provider for MySQL.
 *
 * Shows parameter hints for:
 * - Built-in MySQL functions (instant, no IPC)
 * - Stored procedures and functions (fetched via routine-parameter-cache)
 *
 * Registered as a module side-effect (import './signature-help-provider').
 */

import * as monaco from 'monaco-editor'
import type { editor, Position, CancellationToken } from 'monaco-editor'
import { getBuiltinSignature } from './builtin-function-signatures'
import { getRoutineParameters } from './routine-parameter-cache'
import type { RoutineParameterCacheEntry } from './routine-parameter-cache'
import { getCache, getPendingLoad, loadCache } from './schema-metadata-cache'
import { getModelConnectionId, getSelectedDatabase } from './completion-service'
import { splitStatements, findStatementAtCursor } from './sql-parser-utils'
import { useConnectionStore } from '../../stores/connection-store'

// ---------------------------------------------------------------------------
// Text parsing — pure helpers for scanning SQL text
// ---------------------------------------------------------------------------

/**
 * Check if the character at `pos` in `text` is escaped by a backslash.
 * Counts consecutive backslashes immediately before `pos` — the character
 * is escaped when the count is odd.
 *
 * Example: `\\\\' ` → 4 backslashes → even → quote is NOT escaped.
 *          `\\\'`   → 3 backslashes → odd  → quote IS escaped.
 */
export function isEscapedChar(text: string, pos: number): boolean {
  let count = 0
  let p = pos - 1
  while (p >= 0 && text[p] === '\\') {
    count++
    p--
  }
  return count % 2 === 1
}

/**
 * MySQL `--` comment rule: the character after `--` must be whitespace or an
 * ASCII control character (code point 0x00–0x1F).
 */
function isWhitespaceOrControl(ch: string): boolean {
  return /\s/.test(ch) || ch.charCodeAt(0) <= 0x1f
}

/**
 * Scan the line containing `pos` forward from its start to determine whether
 * `pos` falls inside a `-- ` or `#` line comment.  Returns the index of the
 * comment-start marker when `pos` is inside a comment, or -1 otherwise.
 *
 * MySQL rule: `--` is a comment only when followed by a space or control char.
 * String/backtick literals on the same line are skipped so that `'#'` or
 * `'-- '` inside a string is never mis-detected as a comment marker.
 */
function findLineCommentStart(text: string, pos: number): number {
  let lineStart = pos
  while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart--

  for (let j = lineStart; j <= pos; j++) {
    const ch = text[j]
    // Skip string literals that may contain -- or #
    // Handles both backslash escapes (\') and doubled-quote escapes ('')
    if (ch === "'" || ch === '"') {
      const q = ch
      j++
      while (j < text.length) {
        if (text[j] === q) {
          if (isEscapedChar(text, j)) {
            j++ // skip backslash-escaped quote
            continue
          }
          if (j + 1 < text.length && text[j + 1] === q) {
            j += 2 // skip doubled-quote escape ('' or "")
            continue
          }
          break // unescaped closing quote — end of string
        }
        j++
      }
      if (j > pos) return -1 // pos is inside a literal, not a comment
      continue
    }
    // Skip backtick-quoted identifiers (no backslash escaping in MySQL)
    if (ch === '`') {
      j++
      while (j < text.length && text[j] !== '`') j++
      if (j > pos) return -1 // pos is inside an identifier, not a comment
      continue
    }
    if (ch === '#') return j
    if (
      ch === '-' &&
      j + 1 < text.length &&
      text[j + 1] === '-' &&
      j + 2 < text.length &&
      isWhitespaceOrControl(text[j + 2])
    ) {
      return j
    }
  }
  return -1
}

/**
 * Skip whitespace, block comments, and line comments (`-- ...`, `#...`)
 * backward from `pos`.
 * Returns the new position (may be < 0 if we reached the start).
 */
function skipBackwardWhitespaceAndComments(text: string, pos: number): number {
  while (pos >= 0) {
    if (/\s/.test(text[pos])) {
      pos--
      continue
    }
    // Check for end of block comment: */ (scanned backward = we see '/' then '*')
    if (pos >= 1 && text[pos] === '/' && text[pos - 1] === '*') {
      pos -= 2
      while (pos >= 0 && !(text[pos] === '/' && text[pos + 1] === '*')) pos--
      if (pos >= 0) pos-- // skip past '/'
      continue
    }
    // Check if pos is inside a line comment (-- or #)
    const lcStart = findLineCommentStart(text, pos)
    if (lcStart >= 0 && lcStart <= pos) {
      pos = lcStart - 1
      continue
    }
    break
  }
  return pos
}

/**
 * Skip whitespace, block comments, line comments (`-- `, `#`)
 * forward from `pos`. Returns the new position.
 *
 * Exported with `_` prefix for potential future use and test access.
 */
export function _skipForwardWhitespaceAndComments(text: string, pos: number): number {
  while (pos < text.length) {
    if (/\s/.test(text[pos])) {
      pos++
      continue
    }
    if (text[pos] === '/' && pos + 1 < text.length && text[pos + 1] === '*') {
      pos += 2
      while (pos + 1 < text.length && !(text[pos] === '*' && text[pos + 1] === '/')) pos++
      pos += 2 // skip */
      continue
    }
    if (
      text[pos] === '-' &&
      pos + 1 < text.length &&
      text[pos + 1] === '-' &&
      pos + 2 < text.length &&
      isWhitespaceOrControl(text[pos + 2])
    ) {
      while (pos < text.length && text[pos] !== '\n') pos++
      continue
    }
    if (text[pos] === '#') {
      while (pos < text.length && text[pos] !== '\n') pos++
      continue
    }
    break
  }
  return pos
}

/**
 * Read a SQL identifier backward from `pos` (inclusive).
 * Handles backtick-quoted, double-quoted, and bare identifiers.
 * Returns `{ name, end }` where `end` is the position just before the identifier starts.
 */
function readIdentifierBackward(text: string, pos: number): { name: string; end: number } | null {
  if (pos < 0) return null
  const ch = text[pos]

  if (ch === '`' || ch === '"') {
    const quote = ch
    let start = pos - 1
    while (start >= 0 && text[start] !== quote) start--
    if (start < 0) return null
    return { name: text.slice(start + 1, pos), end: start - 1 }
  }

  if (/[a-zA-Z0-9_$]/.test(ch)) {
    let start = pos
    while (start > 0 && /[a-zA-Z0-9_$]/.test(text[start - 1])) start--
    return { name: text.slice(start, pos + 1), end: start - 1 }
  }

  return null
}

/**
 * Scan forward from `openParenPos + 1` to `cursorPos`, counting top-level
 * commas while skipping nested parens, strings, and comments.
 */
function countActiveParameter(text: string, openParenPos: number, cursorPos: number): number {
  let activeParameter = 0
  let depth = 0
  for (let j = openParenPos + 1; j < cursorPos; j++) {
    const c = text[j]
    if (c === "'") {
      j++
      while (j < cursorPos) {
        if (text[j] === "'" && !isEscapedChar(text, j)) {
          // Check for doubled-quote escape ''
          if (j + 1 < cursorPos && text[j + 1] === "'") {
            j += 2
            continue
          }
          break // end of string
        }
        j++
      }
    } else if (c === '"') {
      j++
      while (j < cursorPos) {
        if (text[j] === '"' && !isEscapedChar(text, j)) {
          // Check for doubled-quote escape ""
          if (j + 1 < cursorPos && text[j + 1] === '"') {
            j += 2
            continue
          }
          break // end of string
        }
        j++
      }
    } else if (c === '`') {
      j++
      while (j < cursorPos && text[j] !== '`') j++
    } else if (c === '/' && j + 1 < text.length && text[j + 1] === '*') {
      j += 2
      while (j + 1 < cursorPos && !(text[j] === '*' && text[j + 1] === '/')) j++
      j++ // skip the /
    } else if (
      c === '-' &&
      j + 1 < text.length &&
      text[j + 1] === '-' &&
      j + 2 < text.length &&
      isWhitespaceOrControl(text[j + 2])
    ) {
      while (j < cursorPos && text[j] !== '\n') j++
    } else if (c === '#') {
      while (j < cursorPos && text[j] !== '\n') j++
    } else if (c === '(') {
      depth++
    } else if (c === ')') {
      depth--
    } else if (c === ',' && depth === 0) {
      activeParameter++
    }
  }
  return activeParameter
}

// ---------------------------------------------------------------------------
// Text parsing — find function context at cursor
// ---------------------------------------------------------------------------

/**
 * Parse backward from `cursorOffset` in `statementText` to find the function
 * call enclosing the cursor, the active parameter index, and whether it's
 * preceded by the CALL keyword.
 *
 * Exported with `_` prefix for test access.
 */
export function _parseFunctionContext(
  statementText: string,
  cursorOffset: number
): {
  functionName: string
  database: string | null
  activeParameter: number
  isCall: boolean
} | null {
  // Step 1: scan backward from cursorOffset-1 to find the opening (
  let depth = 0
  let i = cursorOffset - 1
  let openParenPos = -1

  // Performance optimisation: only call findLineCommentStart() when we might
  // be on a new line.  Line comments end at \n, so if position i+1 was NOT in
  // a comment and we haven't crossed a \n boundary, position i on the same
  // line cannot be inside a comment either.
  let needLineCommentCheck = true

  while (i >= 0) {
    const ch = statementText[i]

    // Check if inside a line comment (-- or #) — only when needed
    if (needLineCommentCheck) {
      const lcStart = findLineCommentStart(statementText, i)
      if (lcStart >= 0 && lcStart <= i) {
        i = lcStart - 1
        needLineCommentCheck = true // jumped to a new position
        continue
      }
      needLineCommentCheck = false
    }

    if (ch === "'") {
      // skip string literal backward
      i--
      while (i >= 0) {
        if (statementText[i] === "'" && !isEscapedChar(statementText, i)) {
          // check for '' escape
          if (i >= 1 && statementText[i - 1] === "'") {
            i -= 2
            continue
          }
          break
        }
        i--
      }
      needLineCommentCheck = true // may have crossed line boundaries
    } else if (ch === '"') {
      // skip double-quoted string/identifier backward (handles \" and "" escapes)
      i--
      while (i >= 0) {
        if (statementText[i] === '"' && !isEscapedChar(statementText, i)) {
          // check for "" escape
          if (i >= 1 && statementText[i - 1] === '"') {
            i -= 2
            continue
          }
          break
        }
        i--
      }
      needLineCommentCheck = true
    } else if (ch === '`') {
      i--
      while (i >= 0 && statementText[i] !== '`') i--
      needLineCommentCheck = true
    } else if (ch === '/' && i > 0 && statementText[i - 1] === '*') {
      // end of block comment — scan backward to /*
      i -= 2
      while (i >= 0 && !(statementText[i] === '/' && statementText[i + 1] === '*')) i--
      needLineCommentCheck = true
    } else if (ch === ')') {
      depth++
    } else if (ch === '(') {
      if (depth === 0) {
        openParenPos = i
        break
      }
      depth--
    } else if (ch === '\n') {
      // Crossing a line boundary — need to re-check for line comments
      needLineCommentCheck = true
    }
    i--
  }

  if (openParenPos < 0) return null

  // Step 2: scan backward from openParenPos-1 to extract function name
  const nameEnd = skipBackwardWhitespaceAndComments(statementText, openParenPos - 1)
  if (nameEnd < 0) return null

  const ident = readIdentifierBackward(statementText, nameEnd)
  if (!ident || !ident.name) return null
  const rawName = ident.name
  const nameStart = ident.end + 1

  // Check for database qualifier: `db`.`func` or db.func
  let database: string | null = null
  let pos = skipBackwardWhitespaceAndComments(statementText, ident.end)
  if (pos >= 0 && statementText[pos] === '.') {
    pos = skipBackwardWhitespaceAndComments(statementText, pos - 1)
    const dbIdent = readIdentifierBackward(statementText, pos)
    if (dbIdent) {
      database = dbIdent.name
      pos = dbIdent.end
    }
  } else {
    pos = nameStart - 1 // reset for CALL check
  }

  // Step 3: check for CALL keyword (skip whitespace + comments before the name)
  const checkPos = skipBackwardWhitespaceAndComments(statementText, pos)
  const isCall =
    checkPos >= 3 &&
    statementText.slice(checkPos - 3, checkPos + 1).toUpperCase() === 'CALL' &&
    (checkPos < 4 || !/[a-zA-Z0-9_$]/.test(statementText[checkPos - 4]))

  // Step 4: count active parameter
  const activeParameter = countActiveParameter(statementText, openParenPos, cursorOffset)

  return { functionName: rawName, database, activeParameter, isCall }
}

// ---------------------------------------------------------------------------
// Build SignatureHelpResult from routine cache entry
// ---------------------------------------------------------------------------

function buildRoutineSignatureResult(
  routineName: string,
  entry: RoutineParameterCacheEntry,
  activeParameter: number
): monaco.languages.SignatureHelpResult {
  const params = entry.parameters.map((p) => {
    const modeStr = p.mode ? `${p.mode} ` : ''
    const label = `${modeStr}${p.name} ${p.dataType}`.trim()
    return { label, documentation: undefined }
  })

  const paramStr = params.map((p) => p.label).join(', ')
  const signatureLabel = `${routineName}(${paramStr})`

  let docValue = ''
  if (entry.returnType) {
    docValue = `→ ${entry.returnType}`
  }

  return {
    value: {
      signatures: [
        {
          label: signatureLabel,
          documentation: docValue ? { value: docValue } : undefined,
          parameters: params,
        },
      ],
      activeSignature: 0,
      activeParameter,
    },
    dispose: () => {},
  }
}

// ---------------------------------------------------------------------------
// Signature help provider
// ---------------------------------------------------------------------------

async function provideSignatureHelp(
  model: editor.ITextModel,
  position: Position,
  token: CancellationToken
): Promise<monaco.languages.SignatureHelpResult | null | undefined> {
  const fullSql = model.getValue()
  const cursorOffset = model.getOffsetAt(position)

  // Use splitStatements + findStatementAtCursor to scope to current statement
  const statements = splitStatements(fullSql)
  const statement = findStatementAtCursor(statements, cursorOffset)
  if (!statement) return undefined

  // Parse on the raw slice (NOT statement.sql which is trimmed)
  const statementSlice = fullSql.slice(statement.start, statement.end)
  const sliceCursorOffset = cursorOffset - statement.start

  const ctx = _parseFunctionContext(statementSlice, sliceCursorOffset)
  if (!ctx) return undefined

  const { functionName, database, activeParameter, isCall } = ctx

  // 1. Check built-in functions — only for unqualified, non-CALL names.
  //    When isCall is true or the name is database-qualified, skip the built-in
  //    map so the user's stored routine is looked up instead.
  if (!isCall && database === null) {
    const builtinSig = getBuiltinSignature(functionName)
    if (builtinSig) {
      return {
        value: {
          signatures: [
            {
              label: builtinSig.label,
              documentation: {
                value: `→ ${builtinSig.returnType}\n\n${builtinSig.documentation}`,
              },
              parameters: builtinSig.parameters.map((p) => ({
                label: p.label,
                documentation: p.documentation ? { value: p.documentation } : undefined,
              })),
            },
          ],
          activeSignature: 0,
          activeParameter,
        },
        dispose: () => {},
      }
    }
  }

  // 2. Stored routine lookup — need a connectionId
  const connectionId = getModelConnectionId(model.uri.toString())
  if (!connectionId) return undefined

  if (token.isCancellationRequested) return undefined

  // Resolve database(s) to search
  const connState = useConnectionStore.getState()
  const conn = connState.activeConnections[connectionId]
  const sessionDb = conn?.sessionDatabase ?? null
  const profileDb = conn?.profile?.defaultDatabase ?? null
  const schemaTreeDb = getSelectedDatabase(connectionId)

  // Deduce routine type
  const routineType: 'FUNCTION' | 'PROCEDURE' = isCall ? 'PROCEDURE' : 'FUNCTION'

  // For database-qualified names: fetch directly without requiring schema cache
  if (database !== null) {
    const entry = await getRoutineParameters(connectionId, database, functionName, routineType)
    if (token.isCancellationRequested) return undefined
    if (entry === null) return undefined
    return buildRoutineSignatureResult(functionName, entry, activeParameter)
  }

  // For unqualified names: check schema metadata cache
  // Await cache readiness (mirrors completion-service.ts pattern)
  const pending = getPendingLoad(connectionId)
  if (pending) await pending
  if (token.isCancellationRequested) return undefined

  let cache = getCache(connectionId)
  if (cache.status === 'empty') {
    // Await the cache load so the first `(` keystroke can still return a result
    await loadCache(connectionId)
    cache = getCache(connectionId)
  }
  if (token.isCancellationRequested) return undefined

  // Search databases in order: sessionDb → profileDb → schemaTreeDb
  const searchDbs = [...new Set([sessionDb, profileDb, schemaTreeDb].filter(Boolean) as string[])]
  for (const db of searchDbs) {
    const routines = cache.routines[db] ?? []
    const routine = routines.find(
      (r) =>
        r.name.toLowerCase() === functionName.toLowerCase() &&
        r.routineType.toUpperCase() === routineType.toUpperCase()
    )
    if (routine) {
      const entry = await getRoutineParameters(connectionId, db, functionName, routineType)
      if (token.isCancellationRequested) return undefined
      if (entry === null) return undefined
      return buildRoutineSignatureResult(functionName, entry, activeParameter)
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Register provider (module side-effect)
// ---------------------------------------------------------------------------

monaco.languages.registerSignatureHelpProvider('mysql', {
  signatureHelpTriggerCharacters: ['(', ','],
  signatureHelpRetriggerCharacters: [','],
  provideSignatureHelp,
})
