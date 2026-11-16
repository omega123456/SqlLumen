import type { editor, Position } from 'monaco-editor'
import type { Suggestions, SyntaxSuggestion } from 'monaco-sql-languages'
import { EntityContextType } from 'dt-sql-parser'
import { stripQuotes } from '../alias-resolver'
import { findStatementAtCursor, splitStatements } from '../sql-parser-utils'
import { isSameTextIgnoringCase } from '../../../lib/value-checks'
import type { CaretText, ParseFallbackMode } from './completion-types'

const SELECT_WILDCARD = '*'
const ROUTINE_DECLARATION_PATTERN = /CREATE\b[\s\S]*\b(?:PROCEDURE|FUNCTION|TRIGGER|EVENT)\b/i
const STORED_PROGRAM_BLOCK_TOKEN_PATTERN =
  /\bBEGIN\b|\bEND\s+(?:IF|CASE|LOOP|WHILE|REPEAT)\b|\bEND\b/gi

function hasSyntaxContext(suggestions: Suggestions, contextType: EntityContextType): boolean {
  return suggestions.syntax.some((suggestion) => suggestion.syntaxContextType === contextType)
}

export function hasColumnContext(suggestions: Suggestions): boolean {
  return hasSyntaxContext(suggestions, EntityContextType.COLUMN)
}

export function hasTableContext(suggestions: Suggestions): boolean {
  return hasSyntaxContext(suggestions, EntityContextType.TABLE)
}

export function hasFunctionContext(suggestions: Suggestions): boolean {
  return hasSyntaxContext(suggestions, EntityContextType.FUNCTION)
}

export function canSupplementStoredProgramBodyKeywords(
  suggestions: Suggestions,
  currentWordPrefix: string
): boolean {
  const hasNoSyntaxSuggestions = suggestions.syntax.length === 0
  if (hasNoSyntaxSuggestions) {
    return true
  }

  return currentWordPrefix.length > 0 && 'DECLARE'.startsWith(currentWordPrefix)
}

function hasUnclosedStoredProgramBegin(statementPrefix: string): boolean {
  const tokens = statementPrefix.match(STORED_PROGRAM_BLOCK_TOKEN_PATTERN) ?? []
  let depth = 0

  for (const token of tokens) {
    const upperToken = token.toUpperCase()

    if (upperToken === 'BEGIN') {
      depth += 1
      continue
    }
    const closesOpenBlock = upperToken === 'END' && depth > 0
    if (closesOpenBlock) {
      depth -= 1
    }
  }

  return depth > 0
}

function stripCommentsAndLiterals(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/#[^\n]*/g, ' ')
    .replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, ' ')
    .replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, ' ')
    .replace(/`[^`]*`/g, ' ')
}

export function isStoredProgramBodyContext(statementPrefix: string): boolean {
  const routineDeclarationPrefixMatch = statementPrefix.match(ROUTINE_DECLARATION_PATTERN)

  if (routineDeclarationPrefixMatch?.index === undefined) {
    return false
  }

  const routinePrefix = statementPrefix.slice(routineDeclarationPrefixMatch.index)
  const sanitizedPrefix = stripCommentsAndLiterals(statementPrefix)
  const sanitizedRoutinePrefix = stripCommentsAndLiterals(routinePrefix)

  return (
    ROUTINE_DECLARATION_PATTERN.test(sanitizedPrefix) &&
    hasUnclosedStoredProgramBegin(sanitizedRoutinePrefix)
  )
}

function getCurrentWordPrefix(model: editor.IReadOnlyModel, position: Position): string {
  return model.getWordUntilPosition(position).word.toUpperCase()
}

function getCurrentStatementPrefix(model: editor.IReadOnlyModel, position: Position): string {
  const sql = model.getValue()
  const caretOffset = model.getOffsetAt(position)
  const statements = splitStatements(sql)
  const statement = findStatementAtCursor(statements, caretOffset)
  const statementStart = statement?.start ?? 0

  return sql.slice(statementStart, caretOffset)
}

function getCurrentStatementText(model: editor.IReadOnlyModel, position: Position): string {
  const sql = model.getValue()
  const caretOffset = model.getOffsetAt(position)
  const statements = splitStatements(sql)
  const statement = findStatementAtCursor(statements, caretOffset)

  return statement?.sql ?? sql
}

function getCursorPrefix(model: editor.IReadOnlyModel, position: Position): string {
  const sql = model.getValue()
  const caretOffset = model.getOffsetAt(position)

  return sql.slice(0, caretOffset)
}

export function readCaretText(model: editor.IReadOnlyModel, position: Position): CaretText {
  return {
    statementPrefix: getCurrentStatementPrefix(model, position),
    statementText: getCurrentStatementText(model, position),
    cursorPrefix: getCursorPrefix(model, position),
    currentWordPrefix: getCurrentWordPrefix(model, position),
  }
}

export function hasDottedPrefixBeforeWord(
  model: editor.IReadOnlyModel,
  position: Position
): boolean {
  const lineContent = model.getLineContent(position.lineNumber)
  const wordInfo = model.getWordUntilPosition(position)
  const textBeforeWord = lineContent.substring(0, wordInfo.startColumn - 1)
  return /[\w`"']\.\s*$/.test(textBeforeWord)
}

export function isInTableReferenceClause(statementPrefix: string): boolean {
  return /\b(?:FROM|JOIN|UPDATE|INTO|TABLE|DESCRIBE|DESC)\s+(?:[\w`"']+\.)?[\w`"']*$/i.test(
    statementPrefix.trimEnd()
  )
}

export function isSelectListContext(statementPrefix: string): boolean {
  const trimmedPrefix = statementPrefix.trimStart()
  return /^SELECT\b/i.test(trimmedPrefix) && !/\bFROM\b/i.test(trimmedPrefix)
}

export function isCallStatementContext(statementPrefix: string): boolean {
  return /^CALL\b/i.test(statementPrefix.trimStart())
}

function syntaxWordText(suggestion: SyntaxSuggestion): string {
  return suggestion.wordRanges.map((wordRange) => wordRange.text).join('')
}

function isWildcardColumnSuggestion(suggestion: SyntaxSuggestion): boolean {
  const isColumnSuggestion = suggestion.syntaxContextType === EntityContextType.COLUMN
  return isColumnSuggestion && syntaxWordText(suggestion) === SELECT_WILDCARD
}

export function isAfterSelectWildcard(suggestions: Suggestions): boolean {
  return suggestions.syntax.some(isWildcardColumnSuggestion)
}

export function getScopedSchemaDatabases(
  databases: readonly string[],
  scopedDatabase: string | null
): readonly string[] {
  if (!scopedDatabase) return databases
  return databases.includes(scopedDatabase) ? [scopedDatabase] : databases
}

export interface ParseFallbackModeRequest {
  statementPrefix: string
  databases: readonly string[]
  scopedDatabase: string | null
}

export function getParseFallbackMode({
  statementPrefix,
  databases,
  scopedDatabase,
}: ParseFallbackModeRequest): ParseFallbackMode {
  if (/\b(?:FROM|JOIN|UPDATE|INTO|TABLE|DESCRIBE|DESC)\s+$/i.test(statementPrefix)) {
    return scopedDatabase
      ? { type: 'databasesAndTables', database: scopedDatabase }
      : { type: 'databases' }
  }

  const tableDotMatch = statementPrefix.match(
    /\b(?:FROM|JOIN|UPDATE|INTO|TABLE|DESCRIBE|DESC)\s+(?:([\w`"']+)\.)?([\w`"']+)\.\s*$/i
  )

  if (!tableDotMatch) {
    return { type: 'all' }
  }

  const qualifier = tableDotMatch[1] ? stripQuotes(tableDotMatch[1]) : null
  const identifier = stripQuotes(tableDotMatch[2])

  if (qualifier) {
    return { type: 'none' }
  }

  const matchedDatabase = databases.find((db) => isSameTextIgnoringCase(db, identifier))
  if (matchedDatabase) {
    return { type: 'tables', database: matchedDatabase }
  }

  return { type: 'none' }
}
