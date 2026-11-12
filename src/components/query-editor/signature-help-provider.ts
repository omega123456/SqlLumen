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
import { getCache, getPendingLoad } from './schema-metadata-cache'
import { getPendingBootstrap } from '../../lib/schema-cache-bootstrap'
import { getModelConnectionId, getSelectedDatabase } from './completion-service'
import { splitStatements, findStatementAtCursor } from './sql-parser-utils'
import { useConnectionStore } from '../../stores/connection-store'

const DOUBLED_QUOTE_LENGTH = 2
const BLOCK_COMMENT_DELIMITER_LENGTH = 2
const LINE_COMMENT_DASHES_LENGTH = 2
const LAST_ASCII_CONTROL_CODE = 0x1f
const CALL_KEYWORD = 'CALL'

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
export function isEscapedChar(text: string, position: number): boolean {
  let isEscaped = false
  let scanPosition = position - 1
  while (scanPosition >= 0 && text[scanPosition] === '\\') {
    isEscaped = !isEscaped
    scanPosition--
  }
  return isEscaped
}

/**
 * MySQL `--` comment rule: the character after `--` must be whitespace or an
 * ASCII control character (code point 0x00–0x1F).
 */
function isWhitespaceOrControl(character: string): boolean {
  return /\s/.test(character) || character.charCodeAt(0) <= LAST_ASCII_CONTROL_CODE
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
function findLineCommentStart(text: string, position: number): number {
  let lineStart = position
  while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart--

  for (let scanIndex = lineStart; scanIndex <= position; scanIndex++) {
    const character = text[scanIndex]
    // Skip string literals that may contain -- or #
    // Handles both backslash escapes (\') and doubled-quote escapes ('')
    if (character === "'" || character === '"') {
      const quote = character
      scanIndex++
      while (scanIndex < text.length) {
        if (text[scanIndex] === quote) {
          if (isEscapedChar(text, scanIndex)) {
            scanIndex++ // skip backslash-escaped quote
            continue
          }
          if (scanIndex + 1 < text.length && text[scanIndex + 1] === quote) {
            scanIndex += DOUBLED_QUOTE_LENGTH
            continue
          }
          break // unescaped closing quote — end of string
        }
        scanIndex++
      }
      if (scanIndex > position) return -1 // pos is inside a literal, not a comment
      continue
    }
    // Skip backtick-quoted identifiers (no backslash escaping in MySQL)
    if (character === '`') {
      scanIndex++
      while (scanIndex < text.length && text[scanIndex] !== '`') scanIndex++
      if (scanIndex > position) return -1 // pos is inside an identifier, not a comment
      continue
    }
    if (character === '#') return scanIndex
    if (
      character === '-' &&
      scanIndex + 1 < text.length &&
      text[scanIndex + 1] === '-' &&
      scanIndex + LINE_COMMENT_DASHES_LENGTH < text.length &&
      isWhitespaceOrControl(text[scanIndex + LINE_COMMENT_DASHES_LENGTH])
    ) {
      return scanIndex
    }
  }
  return -1
}

/**
 * Skip whitespace, block comments, and line comments (`-- ...`, `#...`)
 * backward from `pos`.
 * Returns the new position (may be < 0 if we reached the start).
 */
function skipBackwardWhitespaceAndComments(text: string, position: number): number {
  while (position >= 0) {
    if (/\s/.test(text[position])) {
      position--
      continue
    }
    // Check for end of block comment: */ (scanned backward = we see '/' then '*')
    if (position >= 1 && text[position] === '/' && text[position - 1] === '*') {
      position -= BLOCK_COMMENT_DELIMITER_LENGTH
      while (position >= 0 && !(text[position] === '/' && text[position + 1] === '*')) position--
      if (position >= 0) position-- // skip past '/'
      continue
    }
    // Check if pos is inside a line comment (-- or #)
    const lineCommentStart = findLineCommentStart(text, position)
    if (lineCommentStart >= 0 && lineCommentStart <= position) {
      position = lineCommentStart - 1
      continue
    }
    break
  }
  return position
}

/**
 * Skip whitespace, block comments, line comments (`-- `, `#`)
 * forward from `pos`. Returns the new position.
 *
 * Exported with `_` prefix for potential future use and test access.
 */
export function _skipForwardWhitespaceAndComments(text: string, position: number): number {
  while (position < text.length) {
    if (/\s/.test(text[position])) {
      position++
      continue
    }
    if (text[position] === '/' && position + 1 < text.length && text[position + 1] === '*') {
      position += BLOCK_COMMENT_DELIMITER_LENGTH
      while (position + 1 < text.length && !(text[position] === '*' && text[position + 1] === '/'))
        position++
      position += BLOCK_COMMENT_DELIMITER_LENGTH
      continue
    }
    if (
      text[position] === '-' &&
      position + 1 < text.length &&
      text[position + 1] === '-' &&
      position + LINE_COMMENT_DASHES_LENGTH < text.length &&
      isWhitespaceOrControl(text[position + LINE_COMMENT_DASHES_LENGTH])
    ) {
      while (position < text.length && text[position] !== '\n') position++
      continue
    }
    if (text[position] === '#') {
      while (position < text.length && text[position] !== '\n') position++
      continue
    }
    break
  }
  return position
}

/**
 * Read a SQL identifier backward from `pos` (inclusive).
 * Handles backtick-quoted, double-quoted, and bare identifiers.
 * Returns `{ name, end }` where `end` is the position just before the identifier starts.
 */
function readIdentifierBackward(
  text: string,
  position: number
): { name: string; end: number } | null {
  if (position < 0) return null
  const character = text[position]

  if (character === '`' || character === '"') {
    const quote = character
    let start = position - 1
    while (start >= 0 && text[start] !== quote) start--
    if (start < 0) return null
    return { name: text.slice(start + 1, position), end: start - 1 }
  }

  if (/[a-zA-Z0-9_$]/.test(character)) {
    let start = position
    while (start > 0 && /[a-zA-Z0-9_$]/.test(text[start - 1])) start--
    return { name: text.slice(start, position + 1), end: start - 1 }
  }

  return null
}

/**
 * Scan forward from `openParenPos + 1` to `cursorPos`, counting top-level
 * commas while skipping nested parens, strings, and comments.
 */
function countActiveParameter(
  text: string,
  openParenPosition: number,
  cursorPosition: number
): number {
  let activeParameter = 0
  let depth = 0
  for (let scanIndex = openParenPosition + 1; scanIndex < cursorPosition; scanIndex++) {
    const character = text[scanIndex]
    if (character === "'") {
      scanIndex++
      while (scanIndex < cursorPosition) {
        if (text[scanIndex] === "'" && !isEscapedChar(text, scanIndex)) {
          // Check for doubled-quote escape ''
          if (scanIndex + 1 < cursorPosition && text[scanIndex + 1] === "'") {
            scanIndex += DOUBLED_QUOTE_LENGTH
            continue
          }
          break // end of string
        }
        scanIndex++
      }
    } else if (character === '"') {
      scanIndex++
      while (scanIndex < cursorPosition) {
        if (text[scanIndex] === '"' && !isEscapedChar(text, scanIndex)) {
          // Check for doubled-quote escape ""
          if (scanIndex + 1 < cursorPosition && text[scanIndex + 1] === '"') {
            scanIndex += DOUBLED_QUOTE_LENGTH
            continue
          }
          break // end of string
        }
        scanIndex++
      }
    } else if (character === '`') {
      scanIndex++
      while (scanIndex < cursorPosition && text[scanIndex] !== '`') scanIndex++
    } else if (character === '/' && scanIndex + 1 < text.length && text[scanIndex + 1] === '*') {
      scanIndex += BLOCK_COMMENT_DELIMITER_LENGTH
      while (
        scanIndex + 1 < cursorPosition &&
        !(text[scanIndex] === '*' && text[scanIndex + 1] === '/')
      )
        scanIndex++
      scanIndex++ // skip the /
    } else if (
      character === '-' &&
      scanIndex + 1 < text.length &&
      text[scanIndex + 1] === '-' &&
      scanIndex + LINE_COMMENT_DASHES_LENGTH < text.length &&
      isWhitespaceOrControl(text[scanIndex + LINE_COMMENT_DASHES_LENGTH])
    ) {
      while (scanIndex < cursorPosition && text[scanIndex] !== '\n') scanIndex++
    } else if (character === '#') {
      while (scanIndex < cursorPosition && text[scanIndex] !== '\n') scanIndex++
    } else if (character === '(') {
      depth++
    } else if (character === ')') {
      depth--
    } else if (character === ',' && depth === 0) {
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
  let scanIndex = cursorOffset - 1
  let openParenPosition = -1

  // Performance optimisation: only call findLineCommentStart() when we might
  // be on a new line.  Line comments end at \n, so if position i+1 was NOT in
  // a comment and we haven't crossed a \n boundary, position i on the same
  // line cannot be inside a comment either.
  let needLineCommentCheck = true

  while (scanIndex >= 0) {
    const character = statementText[scanIndex]

    // Check if inside a line comment (-- or #) — only when needed
    if (needLineCommentCheck) {
      const lineCommentStart = findLineCommentStart(statementText, scanIndex)
      if (lineCommentStart >= 0 && lineCommentStart <= scanIndex) {
        scanIndex = lineCommentStart - 1
        needLineCommentCheck = true // jumped to a new position
        continue
      }
      needLineCommentCheck = false
    }

    if (character === "'") {
      // skip string literal backward
      scanIndex--
      while (scanIndex >= 0) {
        if (statementText[scanIndex] === "'" && !isEscapedChar(statementText, scanIndex)) {
          // check for '' escape
          if (scanIndex >= 1 && statementText[scanIndex - 1] === "'") {
            scanIndex -= DOUBLED_QUOTE_LENGTH
            continue
          }
          break
        }
        scanIndex--
      }
      needLineCommentCheck = true // may have crossed line boundaries
    } else if (character === '"') {
      // skip double-quoted string/identifier backward (handles \" and "" escapes)
      scanIndex--
      while (scanIndex >= 0) {
        if (statementText[scanIndex] === '"' && !isEscapedChar(statementText, scanIndex)) {
          // check for "" escape
          if (scanIndex >= 1 && statementText[scanIndex - 1] === '"') {
            scanIndex -= DOUBLED_QUOTE_LENGTH
            continue
          }
          break
        }
        scanIndex--
      }
      needLineCommentCheck = true
    } else if (character === '`') {
      scanIndex--
      while (scanIndex >= 0 && statementText[scanIndex] !== '`') scanIndex--
      needLineCommentCheck = true
    } else if (character === '/' && scanIndex > 0 && statementText[scanIndex - 1] === '*') {
      // end of block comment — scan backward to /*
      scanIndex -= BLOCK_COMMENT_DELIMITER_LENGTH
      while (
        scanIndex >= 0 &&
        !(statementText[scanIndex] === '/' && statementText[scanIndex + 1] === '*')
      )
        scanIndex--
      needLineCommentCheck = true
    } else if (character === ')') {
      depth++
    } else if (character === '(') {
      if (depth === 0) {
        openParenPosition = scanIndex
        break
      }
      depth--
    } else if (character === '\n') {
      // Crossing a line boundary — need to re-check for line comments
      needLineCommentCheck = true
    }
    scanIndex--
  }

  if (openParenPosition < 0) return null

  // Step 2: scan backward from openParenPos-1 to extract function name
  const nameEnd = skipBackwardWhitespaceAndComments(statementText, openParenPosition - 1)
  if (nameEnd < 0) return null

  const ident = readIdentifierBackward(statementText, nameEnd)
  if (!ident || !ident.name) return null
  const rawName = ident.name
  const nameStart = ident.end + 1

  // Check for database qualifier: `db`.`func` or db.func
  let database: string | null = null
  let position = skipBackwardWhitespaceAndComments(statementText, ident.end)
  if (position >= 0 && statementText[position] === '.') {
    position = skipBackwardWhitespaceAndComments(statementText, position - 1)
    const dbIdent = readIdentifierBackward(statementText, position)
    if (dbIdent) {
      database = dbIdent.name
      position = dbIdent.end
    }
  } else {
    position = nameStart - 1 // reset for CALL check
  }

  // Step 3: check for CALL keyword (skip whitespace + comments before the name)
  const checkPosition = skipBackwardWhitespaceAndComments(statementText, position)
  const keywordStart = checkPosition - CALL_KEYWORD.length + 1
  const characterBeforeKeyword = statementText[keywordStart - 1]
  const isCall =
    keywordStart >= 0 &&
    statementText.slice(keywordStart, checkPosition + 1).toUpperCase() === CALL_KEYWORD &&
    (keywordStart === 0 || !/[a-zA-Z0-9_$]/.test(characterBeforeKeyword))

  // Step 4: count active parameter
  const activeParameter = countActiveParameter(statementText, openParenPosition, cursorOffset)

  return {
    functionName: rawName,
    database: database,
    activeParameter: activeParameter,
    isCall: isCall,
  }
}

// ---------------------------------------------------------------------------
// Build SignatureHelpResult from routine cache entry
// ---------------------------------------------------------------------------

function buildRoutineSignatureResult(
  routineName: string,
  entry: RoutineParameterCacheEntry,
  activeParameter: number
): monaco.languages.SignatureHelpResult {
  const params = entry.parameters.map((parameter) => {
    const modePrefix = parameter.mode ? `${parameter.mode} ` : ''
    const label = `${modePrefix}${parameter.name} ${parameter.dataType}`.trim()
    return { label: label, documentation: undefined }
  })

  const parameterList = params.map((parameter) => parameter.label).join(', ')
  const signatureLabel = `${routineName}(${parameterList})`

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
      activeParameter: activeParameter,
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

  const context = _parseFunctionContext(statementSlice, sliceCursorOffset)
  if (!context) return undefined

  const { functionName, database, activeParameter, isCall } = context

  // 1. Check built-in functions — only for unqualified, non-CALL names.
  //    When isCall is true or the name is database-qualified, skip the built-in
  //    map so the user's stored routine is looked up instead.
  if (!isCall && database === null) {
    const builtinSignature = getBuiltinSignature(functionName)
    if (builtinSignature) {
      return {
        value: {
          signatures: [
            {
              label: builtinSignature.label,
              documentation: {
                value: `→ ${builtinSignature.returnType}\n\n${builtinSignature.documentation}`,
              },
              parameters: builtinSignature.parameters.map((parameter) => ({
                label: parameter.label,
                documentation: parameter.documentation
                  ? { value: parameter.documentation }
                  : undefined,
              })),
            },
          ],
          activeSignature: 0,
          activeParameter: activeParameter,
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
  const connectionState = useConnectionStore.getState()
  const connection = connectionState.activeConnections[connectionId]
  const sessionDb = connection?.sessionDatabase ?? null
  const profileDb = connection?.profile?.defaultDatabase ?? null
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

  // If cache is still empty, await the in-flight bootstrap (snapshot hydration)
  const earlyCache = getCache(connectionId)
  if (earlyCache.status === 'empty') {
    const pendingBootstrap = getPendingBootstrap(connectionId)
    if (pendingBootstrap) await pendingBootstrap
    if (token.isCancellationRequested) return undefined
  }

  const cache = getCache(connectionId)
  if (token.isCancellationRequested) return undefined

  // Search databases in order: sessionDb → profileDb → schemaTreeDb
  const searchDbs = [...new Set([sessionDb, profileDb, schemaTreeDb].filter(Boolean) as string[])]
  for (const db of searchDbs) {
    const routines = cache.routines[db] ?? []
    const routine = routines.find(
      (routine) =>
        routine.name.toLowerCase() === functionName.toLowerCase() &&
        routine.routineType.toUpperCase() === routineType.toUpperCase()
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
  provideSignatureHelp: provideSignatureHelp,
})
