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
import { _parseFunctionContext } from './signature-help/function-context-parser'

export { _parseFunctionContext } from './signature-help/function-context-parser'
export { _skipForwardWhitespaceAndComments, isEscapedChar } from './signature-help/sql-text-scan'

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

  const docValue = entry.returnType ? `→ ${entry.returnType}` : ''

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

monaco.languages.registerSignatureHelpProvider('mysql', {
  signatureHelpTriggerCharacters: ['(', ','],
  signatureHelpRetriggerCharacters: [','],
  provideSignatureHelp: provideSignatureHelp,
})
