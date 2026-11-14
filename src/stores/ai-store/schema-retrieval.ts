import type { AiMemory } from '../../lib/ai-memory-commands'
import { semanticSearch } from '../../lib/schema-index-commands'
import { useSchemaIndexStore } from '../schema-index-store'
import { showErrorToast } from '../toast-store'
import { logFrontend } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import { patchTab } from './ai-store-access'
import { getAiSetting } from './chat-actions'
import {
  logDdlSelection,
  logSemanticSearchResults,
  resolveDdlBudget,
  selectNovelDdlChunks,
} from './ddl-selection'
import { retrieveMemories, selectNovelMemories } from './memory-retrieval'
import { buildExpansionConversationContext, expandSearchQueries } from './query-expansion'
import { assembleRetrievalHints } from './retrieval-hints'
import { useAiStore } from '../ai-store'

export type SemanticSearchResult = Awaited<ReturnType<typeof semanticSearch>>[number]

export interface SchemaContext {
  schemaDdl: string
  novelChunkKeys: string[]
  novelDdlTokens: number
  novelMemories: AiMemory[]
  novelMemoryText: string | null
}

const SCHEMA_INDEX_WAIT_MAX_MS = 30000

const SCHEMA_INDEX_POLL_INTERVAL_MS = 500

function emptySchemaContext(): SchemaContext {
  return {
    schemaDdl: '',
    novelChunkKeys: [],
    novelDdlTokens: 0,
    novelMemories: [],
    novelMemoryText: null,
  }
}

export function readPositiveIntegerSetting(key: string, fallback: number): number {
  const value = parseInt(getAiSetting(key) || String(fallback), 10)
  const isUsable = !isNaN(value) && value > 0
  return isUsable ? value : fallback
}

function isSchemaIndexBuilding(sessionId: string): boolean {
  return useSchemaIndexStore.getState().getStatusForSession(sessionId)?.status === 'building'
}

async function pollWhileSchemaIndexBuilds(sessionId: string): Promise<number> {
  let waited = 0
  while (waited < SCHEMA_INDEX_WAIT_MAX_MS) {
    await new Promise((resolve) => setTimeout(resolve, SCHEMA_INDEX_POLL_INTERVAL_MS))
    waited += SCHEMA_INDEX_POLL_INTERVAL_MS
    if (!isSchemaIndexBuilding(sessionId)) break
  }
  return waited
}

async function waitForBuildingSchemaIndex(tabId: string, sessionId: string): Promise<boolean> {
  const indexState = useSchemaIndexStore.getState().getStatusForSession(sessionId)
  logFrontend(
    'debug',
    `[ai-store] schema index status for session=${sessionId}: ${indexState?.status ?? 'unknown'}`
  )
  if (indexState?.status !== 'building') return true

  logFrontend('debug', `[ai-store] index is building — waiting (tabId=${tabId})`)
  if (useAiStore.getState().tabs[tabId]) {
    patchTab(tabId, { isWaitingForIndex: true })
  }
  const waited = await pollWhileSchemaIndexBuilds(sessionId)
  const postWaitStatus = useSchemaIndexStore.getState().getStatusForSession(sessionId)
  logFrontend(
    'debug',
    `[ai-store] done waiting for index — waited=${waited}ms finalStatus=${postWaitStatus?.status ?? 'unknown'}`
  )
  patchTab(tabId, { isWaitingForIndex: false })
  return Boolean(useAiStore.getState().tabs[tabId])
}

async function retrieveSchemaContextUnsafe(
  tabId: string,
  sessionId: string,
  userMessage: string
): Promise<SchemaContext> {
  logFrontend(
    'debug',
    `[ai-store] retrieveSchemaContext start — tabId=${tabId} sessionId=${sessionId} userQuery="${userMessage}"`
  )
  const isTabStillOpen = await waitForBuildingSchemaIndex(tabId, sessionId)
  if (!isTabStillOpen) return emptySchemaContext()

  const allMemories = await retrieveMemories(sessionId, userMessage)
  const memoryContext = selectNovelMemories(tabId, allMemories)
  const tabState = useAiStore.getState().tabs[tabId]
  const attachedSql = tabState?.attachedContext?.sql ?? ''
  const queries = await expandSearchQueries({
    tabId: tabId,
    sessionId: sessionId,
    userMessage: userMessage,
    conversationContext: buildExpansionConversationContext(tabState, allMemories),
    attachedSql: attachedSql,
  })
  const hints = assembleRetrievalHints(sessionId, attachedSql)

  logFrontend(
    'debug',
    `[ai-store] invoking semantic search — sessionId=${sessionId} queryCount=${queries.length} queries=${JSON.stringify(queries)}`
  )
  const results = await semanticSearch(sessionId, queries, hints)
  logSemanticSearchResults(results)

  const selection = selectNovelDdlChunks(
    results,
    resolveDdlBudget(useAiStore.getState().tabs[tabId])
  )
  const ddl = selection.ddlParts.join('\n\n')
  logDdlSelection(selection, ddl)
  return {
    schemaDdl: ddl,
    novelChunkKeys: selection.novelChunkKeys,
    novelDdlTokens: selection.tokens,
    novelMemories: memoryContext.includedMemories,
    novelMemoryText: memoryContext.text,
  }
}

export async function retrieveSchemaContext(
  tabId: string,
  sessionId: string,
  userMessage: string
): Promise<SchemaContext> {
  try {
    return await retrieveSchemaContextUnsafe(tabId, sessionId, userMessage)
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontend('error', `[ai-store] Schema retrieval failed: ${message}`)
    showErrorToast('Schema retrieval failed', message)
    if (useAiStore.getState().tabs[tabId]) {
      patchTab(tabId, { isWaitingForIndex: false })
    }
    return emptySchemaContext()
  }
}
