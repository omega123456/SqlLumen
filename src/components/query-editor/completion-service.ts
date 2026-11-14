import type { languages, editor, Position } from 'monaco-editor'
import type { CompletionService, ICompletionItem, CompletionSnippet } from 'monaco-sql-languages'
import type { Suggestions, EntityContext } from 'monaco-sql-languages'
import { getCache } from './schema-metadata-cache'
import { buildAliasMap } from './alias-resolver'
import { logParseFallback } from '../../lib/app-log-commands'
import { useConnectionStore } from '../../stores/connection-store'
import { parseNodeId, useSchemaStore } from '../../stores/schema-store'
import { useSettingsStore } from '../../stores/settings-store'
import type { TabType } from '../../types/schema'
import { hasFunctionContext, readCaretText } from './completion-service/caret-context'
import {
  keywordItem,
  mapSnippetsToItems,
  schemaUnavailableItems,
} from './completion-service/completion-items'
import {
  pushBuiltinFunctions,
  pushFallbackKeywordsAndFunctions,
  pushStoredProgramBodyKeywords,
} from './completion-service/completion-item-push'
import type { CaretText } from './completion-service/completion-types'
import { resolveDotCompletions } from './completion-service/dot-completions'
import { buildParseFallback } from './completion-service/parse-fallback'
import { buildSyntaxCompletions } from './completion-service/syntax-completions'

interface ModelContext {
  connectionId: string
  tabId: string
  tabType: TabType
}

const modelConnections = new Map<string, ModelContext>()

export interface ModelConnectionRegistration {
  uri: string
  connectionId: string
  tabId?: string
  tabType?: TabType
}

export function registerModelConnection({
  uri,
  connectionId,
  tabId,
  tabType,
}: ModelConnectionRegistration): void {
  modelConnections.set(uri, {
    connectionId: connectionId,
    tabId: tabId ?? '',
    tabType: tabType ?? 'query-editor',
  })
}

export function unregisterModelConnection(uri: string): void {
  modelConnections.delete(uri)
}

export function getModelConnectionId(uri: string): string | undefined {
  return modelConnections.get(uri)?.connectionId
}

export function getModelContext(
  uri: string
): { connectionId: string; tabId: string; tabType: TabType } | undefined {
  return modelConnections.get(uri)
}

export function resetModelConnections(): void {
  modelConnections.clear()
}

export function getSelectedDatabase(connectionId: string | undefined): string | null {
  if (!connectionId) return null

  const selectedNodeId = useSchemaStore.getState().connectionStates[connectionId]?.selectedNodeId
  if (!selectedNodeId) return null

  try {
    const parsed = parseNodeId(selectedNodeId)
    return parsed.database || null
  } catch (error) {
    logParseFallback('[completion-service] getSelectedDatabase', error)
    return null
  }
}

function resolveActiveDatabase(connectionId: string | undefined): string | null {
  if (!connectionId) return null
  const activeConnection = useConnectionStore.getState().activeConnections[connectionId]
  return activeConnection?.sessionDatabase ?? activeConnection?.profile.defaultDatabase ?? null
}

interface CompletionDatabases {
  resolutionDatabase: string | null
  selectedDatabase: string | null
  broadSuggestionDatabase: string | null
}

function resolveCompletionDatabases(connectionId: string | undefined): CompletionDatabases {
  const activeDatabase = resolveActiveDatabase(connectionId)
  const selectedDatabase = getSelectedDatabase(connectionId)
  return {
    resolutionDatabase: activeDatabase ?? selectedDatabase,
    selectedDatabase: selectedDatabase,
    broadSuggestionDatabase: selectedDatabase ?? activeDatabase,
  }
}

function isBacktickQuotingEnabled(): boolean {
  return useSettingsStore.getState().getSetting('editor.autocompleteBackticks') === 'true'
}

function hasParserKeywords(suggestions: Suggestions | null): suggestions is Suggestions {
  return suggestions !== null && suggestions.keywords.length > 0
}

function hasUsableSuggestions(suggestions: Suggestions | null): suggestions is Suggestions {
  if (suggestions === null) return false
  return suggestions.syntax.length > 0 || suggestions.keywords.length > 0
}

interface ConnectionlessCompletionRequest {
  suggestions: Suggestions | null
  caret: CaretText
  snippets: CompletionSnippet[] | undefined
}

function buildConnectionlessCompletions(
  request: ConnectionlessCompletionRequest
): ICompletionItem[] {
  const { suggestions, caret } = request
  const items: ICompletionItem[] = []
  if (!hasParserKeywords(suggestions)) {
    pushFallbackKeywordsAndFunctions(items)
    items.push(...mapSnippetsToItems(request.snippets))
    return items
  }
  items.push(...suggestions.keywords.map((keyword) => keywordItem(keyword)))
  pushStoredProgramBodyKeywords({
    items: items,
    statementPrefix: caret.cursorPrefix,
    suggestions: suggestions,
    currentWordPrefix: caret.currentWordPrefix,
    existingKeywords: suggestions.keywords,
  })
  if (hasFunctionContext(suggestions)) {
    pushBuiltinFunctions(items, null)
  }
  items.push(...mapSnippetsToItems(request.snippets))
  return items
}

interface CompletionServiceRequest {
  model: editor.IReadOnlyModel
  position: Position
  completionContext: languages.CompletionContext
  suggestions: Suggestions | null
  entities: EntityContext[] | null
  snippets?: CompletionSnippet[]
}

export const completionService: CompletionService = (...monacoArguments) => {
  const [model, position, completionContext, suggestions, entities, snippets] = monacoArguments
  return provideCompletions({
    model: model,
    position: position,
    completionContext: completionContext,
    suggestions: suggestions,
    entities: entities,
    snippets: snippets,
  })
}

async function provideCompletions({
  model,
  position,
  completionContext,
  suggestions,
  entities,
  snippets,
}: CompletionServiceRequest): Promise<ICompletionItem[]> {
  const quoteIdentifiers = isBacktickQuotingEnabled()
  const connectionId = modelConnections.get(model.uri.toString())?.connectionId
  const databases = resolveCompletionDatabases(connectionId)
  const caret = readCaretText(model, position)
  const aliasMap = buildAliasMap(entities, databases.resolutionDatabase)

  if (!connectionId) {
    return buildConnectionlessCompletions({
      suggestions: suggestions,
      caret: caret,
      snippets: snippets,
    })
  }

  const cache = getCache(connectionId)
  if (cache.status === 'error') {
    return schemaUnavailableItems()
  }

  const dotCompletions = resolveDotCompletions(
    {
      model: model,
      position: position,
      cache: cache,
      aliasMap: aliasMap,
      resolutionDatabase: databases.resolutionDatabase,
      caret: caret,
      quoteIdentifiers: quoteIdentifiers,
    },
    completionContext
  )
  if (dotCompletions !== null) return dotCompletions

  if (!hasUsableSuggestions(suggestions)) {
    return buildParseFallback({
      cache: cache,
      statementPrefix: caret.statementPrefix,
      selectedDatabase: databases.selectedDatabase,
      broadSuggestionDatabase: databases.broadSuggestionDatabase,
      snippets: snippets,
      quoteIdentifiers: quoteIdentifiers,
    })
  }

  return buildSyntaxCompletions({
    ...databases,
    cache: cache,
    suggestions: suggestions,
    entities: entities,
    snippets: snippets,
    caret: caret,
    quoteIdentifiers: quoteIdentifiers,
  })
}
