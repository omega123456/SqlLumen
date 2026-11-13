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
import { isSameTextIgnoringCase } from '../../lib/value-checks'

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
  while (text[scanPosition] === '\\') {
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

const IDENTIFIER_CHARACTER = /[a-zA-Z0-9_$]/
const PAREN_DEPTH_CHANGE_FORWARD: Record<string, number> = { '(': 1, ')': -1 }
const PAREN_DEPTH_CHANGE_BACKWARD: Record<string, number> = { ')': 1, '(': -1 }
const NOT_FOUND = -1
const QUOTED_IDENTIFIER_CHARACTERS: ReadonlySet<string> = new Set(['`', '"'])

interface ForwardCharacterScan {
  text: string
  stopCharacter: string
  limit: number
}

function canScanForwardTo(scan: ForwardCharacterScan, index: number): boolean {
  return index < scan.limit && scan.text[index] !== scan.stopCharacter
}

function canScanBackwardTo(text: string, index: number, stopCharacter: string): boolean {
  return index >= 0 && text[index] !== stopCharacter
}

function isIdentifierCharacterAt(text: string, index: number): boolean {
  return index >= 0 && IDENTIFIER_CHARACTER.test(text[index])
}

function isUnescapedQuoteAt(text: string, index: number, quote: string): boolean {
  return text[index] === quote && !isEscapedChar(text, index)
}

function canScanForwardToBlockCommentClose(text: string, index: number, limit: number): boolean {
  const isCloseAt = text[index] === '*' && text[index + 1] === '/'
  return index + 1 < limit && !isCloseAt
}

function canScanBackwardToBlockCommentOpen(text: string, index: number): boolean {
  return index >= 0 && !isBlockCommentOpenAt(text, index)
}

function isQuoteCharacter(character: string): boolean {
  return character === "'" || character === '"'
}

function isLineCommentDashesAt(text: string, index: number): boolean {
  const startsWithDashes = text[index] === '-' && text[index + 1] === '-'
  if (!startsWithDashes) return false
  const characterAfterDashes = index + LINE_COMMENT_DASHES_LENGTH
  return characterAfterDashes < text.length && isWhitespaceOrControl(text[characterAfterDashes])
}

function isLineCommentMarkerAt(text: string, index: number): boolean {
  return text[index] === '#' || isLineCommentDashesAt(text, index)
}

function isBlockCommentOpenAt(text: string, index: number): boolean {
  return text[index] === '/' && text[index + 1] === '*'
}

function isBlockCommentCloseAt(text: string, index: number): boolean {
  return index >= 1 && text[index] === '/' && text[index - 1] === '*'
}

function isDoubledQuoteAt(text: string, index: number, limit: number): boolean {
  return index + 1 < limit && text[index + 1] === text[index]
}

function findLineStart(text: string, position: number): number {
  let lineStart = position
  while (canScanBackwardTo(text, lineStart - 1, '\n')) lineStart--
  return lineStart
}

function skipQuotedForward(text: string, quoteIndex: number, limit: number): number {
  const quote = text[quoteIndex]
  let scanIndex = quoteIndex + 1
  while (scanIndex < limit) {
    if (!isUnescapedQuoteAt(text, scanIndex, quote)) {
      scanIndex++
      continue
    }
    if (isDoubledQuoteAt(text, scanIndex, limit)) {
      scanIndex += DOUBLED_QUOTE_LENGTH
      continue
    }
    return scanIndex
  }
  return scanIndex
}

function skipBacktickForward(text: string, backtickIndex: number, limit: number): number {
  const scan: ForwardCharacterScan = { text: text, stopCharacter: '`', limit: limit }
  let scanIndex = backtickIndex + 1
  while (canScanForwardTo(scan, scanIndex)) scanIndex++
  return scanIndex
}

function findBlockCommentCloseForward(text: string, from: number, limit: number): number {
  let scanIndex = from
  while (canScanForwardToBlockCommentClose(text, scanIndex, limit)) {
    scanIndex++
  }
  return scanIndex
}

function skipToLineEnd(text: string, from: number, limit: number): number {
  const scan: ForwardCharacterScan = { text: text, stopCharacter: '\n', limit: limit }
  let scanIndex = from
  while (canScanForwardTo(scan, scanIndex)) scanIndex++
  return scanIndex
}

function skipLiteralForward(text: string, index: number): number | null {
  const character = text[index]
  if (isQuoteCharacter(character)) return skipQuotedForward(text, index, text.length)
  if (character === '`') return skipBacktickForward(text, index, text.length)
  return null
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
  for (let scanIndex = findLineStart(text, position); scanIndex <= position; scanIndex++) {
    const literalEnd = skipLiteralForward(text, scanIndex)
    if (literalEnd !== null) {
      if (literalEnd > position) return NOT_FOUND
      scanIndex = literalEnd
      continue
    }
    if (isLineCommentMarkerAt(text, scanIndex)) return scanIndex
  }
  return NOT_FOUND
}

function lineCommentJumpTarget(text: string, position: number): number | null {
  const lineCommentStart = findLineCommentStart(text, position)
  const isInsideLineComment = lineCommentStart >= 0 && lineCommentStart <= position
  return isInsideLineComment ? lineCommentStart - 1 : null
}

function findBlockCommentOpenBackward(text: string, closeIndex: number): number {
  let scanIndex = closeIndex - BLOCK_COMMENT_DELIMITER_LENGTH
  while (canScanBackwardToBlockCommentOpen(text, scanIndex)) scanIndex--
  return scanIndex
}

function stepBackOverTrivia(text: string, position: number): number | null {
  if (/\s/.test(text[position])) return position - 1
  if (isBlockCommentCloseAt(text, position)) {
    const openIndex = findBlockCommentOpenBackward(text, position)
    return Math.max(openIndex - 1, NOT_FOUND)
  }
  return lineCommentJumpTarget(text, position)
}

/**
 * Skip whitespace, block comments, and line comments (`-- ...`, `#...`)
 * backward from `pos`.
 * Returns the new position (may be < 0 if we reached the start).
 */
function skipBackwardWhitespaceAndComments(text: string, position: number): number {
  let scanPosition = position
  while (scanPosition >= 0) {
    const nextPosition = stepBackOverTrivia(text, scanPosition)
    if (nextPosition === null) return scanPosition
    scanPosition = nextPosition
  }
  return scanPosition
}

function stepForwardOverTrivia(text: string, position: number): number | null {
  if (/\s/.test(text[position])) return position + 1
  if (isBlockCommentOpenAt(text, position)) {
    const contentStart = position + BLOCK_COMMENT_DELIMITER_LENGTH
    const closeIndex = findBlockCommentCloseForward(text, contentStart, text.length)
    return closeIndex + BLOCK_COMMENT_DELIMITER_LENGTH
  }
  if (isLineCommentMarkerAt(text, position)) return skipToLineEnd(text, position, text.length)
  return null
}

/**
 * Skip whitespace, block comments, line comments (`-- `, `#`)
 * forward from `pos`. Returns the new position.
 *
 * Exported with `_` prefix for potential future use and test access.
 */
export function _skipForwardWhitespaceAndComments(text: string, position: number): number {
  let scanPosition = position
  while (scanPosition < text.length) {
    const nextPosition = stepForwardOverTrivia(text, scanPosition)
    if (nextPosition === null) return scanPosition
    scanPosition = nextPosition
  }
  return scanPosition
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

  if (QUOTED_IDENTIFIER_CHARACTERS.has(character)) {
    const quote = character
    let start = position - 1
    while (canScanBackwardTo(text, start, quote)) start--
    if (start < 0) return null
    return { name: text.slice(start + 1, position), end: start - 1 }
  }

  if (IDENTIFIER_CHARACTER.test(character)) {
    let start = position
    while (isIdentifierCharacterAt(text, start - 1)) start--
    return { name: text.slice(start, position + 1), end: start - 1 }
  }

  return null
}

function skipNonCodeForward(text: string, index: number, cursorPosition: number): number | null {
  const character = text[index]
  if (isQuoteCharacter(character)) return skipQuotedForward(text, index, cursorPosition)
  if (character === '`') return skipBacktickForward(text, index, cursorPosition)
  if (isBlockCommentOpenAt(text, index)) {
    const contentStart = index + BLOCK_COMMENT_DELIMITER_LENGTH
    return findBlockCommentCloseForward(text, contentStart, cursorPosition) + 1
  }
  if (isLineCommentMarkerAt(text, index)) return skipToLineEnd(text, index, cursorPosition)
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
    const skippedTo = skipNonCodeForward(text, scanIndex, cursorPosition)
    if (skippedTo !== null) {
      scanIndex = skippedTo
      continue
    }
    const character = text[scanIndex]
    depth += PAREN_DEPTH_CHANGE_FORWARD[character] ?? 0
    const isTopLevelComma = character === ',' && depth === 0
    if (isTopLevelComma) activeParameter++
  }
  return activeParameter
}

function skipQuotedBackward(text: string, closingIndex: number): number {
  const quote = text[closingIndex]
  let scanIndex = closingIndex - 1
  while (scanIndex >= 0) {
    if (!isUnescapedQuoteAt(text, scanIndex, quote)) {
      scanIndex--
      continue
    }
    const isDoubledQuote = scanIndex >= 1 && text[scanIndex - 1] === quote
    if (isDoubledQuote) {
      scanIndex -= DOUBLED_QUOTE_LENGTH
      continue
    }
    return scanIndex
  }
  return scanIndex
}

function skipBacktickBackward(text: string, closingIndex: number): number {
  let scanIndex = closingIndex - 1
  while (canScanBackwardTo(text, scanIndex, '`')) scanIndex--
  return scanIndex
}

function skipNonCodeBackward(text: string, index: number): number | null {
  const character = text[index]
  if (isQuoteCharacter(character)) return skipQuotedBackward(text, index)
  if (character === '`') return skipBacktickBackward(text, index)
  if (isBlockCommentCloseAt(text, index)) return findBlockCommentOpenBackward(text, index)
  return null
}

function findEnclosingOpenParen(text: string, cursorOffset: number): number {
  let depth = 0
  let scanIndex = cursorOffset - 1
  // Line comments end at \n, so the costly line-comment scan only reruns after crossing a line.
  let needLineCommentCheck = true

  while (scanIndex >= 0) {
    if (needLineCommentCheck) {
      const commentJump = lineCommentJumpTarget(text, scanIndex)
      if (commentJump !== null) {
        scanIndex = commentJump
        continue
      }
      needLineCommentCheck = false
    }

    const literalStart = skipNonCodeBackward(text, scanIndex)
    if (literalStart !== null) {
      scanIndex = literalStart - 1
      needLineCommentCheck = true
      continue
    }

    const character = text[scanIndex]
    const isOpeningParenthesis = character === '(' && depth === 0
    if (isOpeningParenthesis) return scanIndex
    depth += PAREN_DEPTH_CHANGE_BACKWARD[character] ?? 0
    if (character === '\n') needLineCommentCheck = true
    scanIndex--
  }
  return NOT_FOUND
}

interface QualifiedFunctionName {
  functionName: string
  database: string | null
  positionBeforeName: number
}

function readDatabaseQualifier(
  text: string,
  nameEnd: number
): { database: string | null; positionBeforeName: number } {
  const positionBeforeName = skipBackwardWhitespaceAndComments(text, nameEnd)
  if (text[positionBeforeName] !== '.') {
    return { database: null, positionBeforeName: nameEnd }
  }
  const qualifierEnd = skipBackwardWhitespaceAndComments(text, positionBeforeName - 1)
  const qualifier = readIdentifierBackward(text, qualifierEnd)
  if (!qualifier) return { database: null, positionBeforeName: qualifierEnd }
  return { database: qualifier.name, positionBeforeName: qualifier.end }
}

function readQualifiedFunctionName(
  text: string,
  openParenPosition: number
): QualifiedFunctionName | null {
  const nameEnd = skipBackwardWhitespaceAndComments(text, openParenPosition - 1)
  if (nameEnd < 0) return null
  const identifier = readIdentifierBackward(text, nameEnd)
  if (!identifier?.name) return null
  const qualifier = readDatabaseQualifier(text, identifier.end)
  return {
    functionName: identifier.name,
    database: qualifier.database,
    positionBeforeName: qualifier.positionBeforeName,
  }
}

function isPrecededByCallKeyword(text: string, position: number): boolean {
  const checkPosition = skipBackwardWhitespaceAndComments(text, position)
  const keywordStart = checkPosition - CALL_KEYWORD.length + 1
  if (keywordStart < 0) return false
  const precedingWord = text.slice(keywordStart, checkPosition + 1).toUpperCase()
  if (precedingWord !== CALL_KEYWORD) return false
  return keywordStart === 0 || !IDENTIFIER_CHARACTER.test(text[keywordStart - 1])
}

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
  const openParenPosition = findEnclosingOpenParen(statementText, cursorOffset)
  if (openParenPosition < 0) return null
  const name = readQualifiedFunctionName(statementText, openParenPosition)
  if (!name) return null
  return {
    functionName: name.functionName,
    database: name.database,
    activeParameter: countActiveParameter(statementText, openParenPosition, cursorOffset),
    isCall: isPrecededByCallKeyword(statementText, name.positionBeforeName),
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

type FunctionContext = NonNullable<ReturnType<typeof _parseFunctionContext>>

interface RoutineLookup {
  connectionId: string
  functionName: string
  routineType: 'FUNCTION' | 'PROCEDURE'
  activeParameter: number
}

function parseFunctionContextAtCursor(
  model: editor.ITextModel,
  position: Position
): FunctionContext | null {
  const fullSql = model.getValue()
  const cursorOffset = model.getOffsetAt(position)
  const statement = findStatementAtCursor(splitStatements(fullSql), cursorOffset)
  if (!statement) return null
  // Parse the raw slice: statement.sql is trimmed and would shift the cursor offset.
  const statementSlice = fullSql.slice(statement.start, statement.end)
  return _parseFunctionContext(statementSlice, cursorOffset - statement.start)
}

function isBuiltinCandidate(context: FunctionContext): boolean {
  return !context.isCall && context.database === null
}

function buildBuiltinSignatureResult(
  functionName: string,
  activeParameter: number
): monaco.languages.SignatureHelpResult | null {
  const builtinSignature = getBuiltinSignature(functionName)
  if (!builtinSignature) return null
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
            documentation: parameter.documentation ? { value: parameter.documentation } : undefined,
          })),
        },
      ],
      activeSignature: 0,
      activeParameter: activeParameter,
    },
    dispose: () => {},
  }
}

function isPresentDatabase(database: string | null | undefined): database is string {
  return Boolean(database)
}

function routineSearchDatabases(connectionId: string): string[] {
  const connection = useConnectionStore.getState().activeConnections[connectionId]
  const candidates = [
    connection?.sessionDatabase,
    connection?.profile?.defaultDatabase,
    getSelectedDatabase(connectionId),
  ]
  return [...new Set(candidates.filter(isPresentDatabase))]
}

async function awaitSchemaCache(connectionId: string, token: CancellationToken): Promise<boolean> {
  const pending = getPendingLoad(connectionId)
  if (pending) await pending
  if (token.isCancellationRequested) return false
  if (getCache(connectionId).status !== 'empty') return true
  const pendingBootstrap = getPendingBootstrap(connectionId)
  if (pendingBootstrap) await pendingBootstrap
  return !token.isCancellationRequested
}

function isRoutineForLookup(
  routine: { name: string; routineType: string },
  lookup: RoutineLookup
): boolean {
  const isSameRoutineType = routine.routineType.toUpperCase() === lookup.routineType.toUpperCase()
  return isSameTextIgnoringCase(routine.name, lookup.functionName) && isSameRoutineType
}

function hasCachedRoutine(
  cache: ReturnType<typeof getCache>,
  database: string,
  lookup: RoutineLookup
): boolean {
  const routines = cache.routines[database] ?? []
  return routines.some((routine) => isRoutineForLookup(routine, lookup))
}

async function findCachedRoutineDatabase(
  lookup: RoutineLookup,
  searchDatabases: string[],
  token: CancellationToken
): Promise<string | null> {
  const isCacheReady = await awaitSchemaCache(lookup.connectionId, token)
  if (!isCacheReady) return null
  const cache = getCache(lookup.connectionId)
  const database = searchDatabases.find((candidate) => hasCachedRoutine(cache, candidate, lookup))
  return database ?? null
}

async function fetchRoutineSignature(
  lookup: RoutineLookup,
  database: string,
  token: CancellationToken
): Promise<monaco.languages.SignatureHelpResult | undefined> {
  const entry = await getRoutineParameters({
    connectionId: lookup.connectionId,
    database: database,
    routineName: lookup.functionName,
    routineType: lookup.routineType,
  })
  if (token.isCancellationRequested) return undefined
  if (entry === null) return undefined
  return buildRoutineSignatureResult(lookup.functionName, entry, lookup.activeParameter)
}

async function provideSignatureHelp(
  model: editor.ITextModel,
  position: Position,
  token: CancellationToken
): Promise<monaco.languages.SignatureHelpResult | null | undefined> {
  const context = parseFunctionContextAtCursor(model, position)
  if (!context) return undefined

  // A CALL or database-qualified name targets a stored routine, never a built-in.
  if (isBuiltinCandidate(context)) {
    const builtinResult = buildBuiltinSignatureResult(context.functionName, context.activeParameter)
    if (builtinResult) return builtinResult
  }

  const connectionId = getModelConnectionId(model.uri.toString())
  if (!connectionId) return undefined
  if (token.isCancellationRequested) return undefined

  const searchDatabases = routineSearchDatabases(connectionId)
  const lookup: RoutineLookup = {
    connectionId: connectionId,
    functionName: context.functionName,
    routineType: context.isCall ? 'PROCEDURE' : 'FUNCTION',
    activeParameter: context.activeParameter,
  }

  if (context.database !== null) {
    return fetchRoutineSignature(lookup, context.database, token)
  }

  const database = await findCachedRoutineDatabase(lookup, searchDatabases, token)
  if (database === null) return undefined
  return fetchRoutineSignature(lookup, database, token)
}

// ---------------------------------------------------------------------------
// Register provider (module side-effect)
// ---------------------------------------------------------------------------

monaco.languages.registerSignatureHelpProvider('mysql', {
  signatureHelpTriggerCharacters: ['(', ','],
  signatureHelpRetriggerCharacters: [','],
  provideSignatureHelp: provideSignatureHelp,
})
