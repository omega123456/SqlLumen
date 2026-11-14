import type { AiMessage, AttachedContext } from '../ai-store'
import { patchTab } from './ai-store-access'
import { AI_SYSTEM_PROMPT } from './chat-actions'
import {
  buildAttachedContextMessage,
  findBaseSystemPrompt,
  isBaseSystemMessage,
  upsertContextMessage,
  withKeys,
} from './context-messages'
import type { ContextMessageDraft } from './context-messages'
import { memoryKey } from './memory-retrieval'
import { retrieveSchemaContext } from './schema-retrieval'
import type { SchemaContext } from './schema-retrieval'
import { useAiStore } from '../ai-store'

function ensureBaseSystemPrompt(tabId: string, systemContent: string): void {
  const currentTab = useAiStore.getState().tabs[tabId]
  if (!currentTab) return

  const existingIndex = currentTab.messages.findIndex(isBaseSystemMessage)
  if (existingIndex >= 0) {
    return
  }

  const systemMessage: AiMessage = {
    id: crypto.randomUUID(),
    role: 'system',
    content: systemContent,
    timestamp: Date.now(),
  }
  patchTab(tabId, {
    messages: [systemMessage, ...currentTab.messages],
  })
}

function appendContextMessage(tabId: string, userMessageId: string, message: AiMessage): void {
  const currentTab = useAiStore.getState().tabs[tabId]
  if (!currentTab) return

  const nextMessages = [...currentTab.messages]
  const userIndex = nextMessages.findIndex((message) => message.id === userMessageId)
  if (userIndex < 0) return

  nextMessages.splice(userIndex, 0, message)
  patchTab(tabId, { messages: nextMessages })
}

export function getCurrentSystemPrompt(tabId: string): string {
  return findBaseSystemPrompt(useAiStore.getState().tabs[tabId]?.messages ?? [])
}

function upsertPromptOnlyContextMessages(
  tabId: string,
  userMessageId: string,
  contextMessages: ContextMessageDraft[]
): void {
  const currentTab = useAiStore.getState().tabs[tabId]
  if (!currentTab) return
  if (contextMessages.length === 0) return

  const nextMessages = [...currentTab.messages]
  const userIndex = nextMessages.findIndex((message) => message.id === userMessageId)
  if (userIndex < 0) return

  let changed = false
  for (const contextMessage of contextMessages) {
    if (upsertContextMessage(nextMessages, userIndex, contextMessage)) {
      changed = true
    }
  }

  if (changed) {
    patchTab(tabId, { messages: nextMessages })
  }
}

export function removePromptOnlyContextMessages(
  tabId: string,
  kinds: Array<NonNullable<AiMessage['kind']>>
): void {
  const currentTab = useAiStore.getState().tabs[tabId]
  if (!currentTab) return
  if (kinds.length === 0) return

  const kindSet = new Set(kinds)
  const nextMessages = currentTab.messages.filter(
    (message) => !(message.kind && kindSet.has(message.kind))
  )

  const hasRemovedMessages = nextMessages.length !== currentTab.messages.length
  if (hasRemovedMessages) {
    patchTab(tabId, { messages: nextMessages })
  }
}

function appendNovelContextMessages(
  tabId: string,
  userMessageId: string,
  context: SchemaContext
): void {
  const hasNovelSchemaChunks = context.novelChunkKeys.length > 0
  const hasNovelMemories = context.novelMemories.length > 0
  if (context.schemaDdl && hasNovelSchemaChunks) {
    appendContextMessage(tabId, userMessageId, {
      id: crypto.randomUUID(),
      role: 'user',
      content: context.schemaDdl,
      timestamp: Date.now(),
      kind: 'schema-context',
      chunkKeys: context.novelChunkKeys,
    })
  }
  if (context.novelMemoryText && hasNovelMemories) {
    appendContextMessage(tabId, userMessageId, {
      id: crypto.randomUUID(),
      role: 'user',
      content: context.novelMemoryText,
      timestamp: Date.now(),
      kind: 'memory-context',
      memoryIds: context.novelMemories.map((memory) => memoryKey(memory)),
    })
  }
}

function syncAttachedContextMessage(
  tabId: string,
  userMessageId: string,
  attachedContext: AttachedContext | null
): void {
  if (!attachedContext) {
    removePromptOnlyContextMessages(tabId, ['attached-context'])
    return
  }
  upsertPromptOnlyContextMessages(tabId, userMessageId, [
    {
      role: 'user' as const,
      content: buildAttachedContextMessage(attachedContext.sql),
      kind: 'attached-context' as const,
    },
  ])
}

function recordProvidedContext(tabId: string, context: SchemaContext): void {
  const hasNovelContext = context.novelChunkKeys.length > 0 || context.novelMemories.length > 0
  if (!hasNovelContext) return
  const currentTabState = useAiStore.getState().tabs[tabId]
  if (!currentTabState) return
  patchTab(tabId, {
    providedChunkKeys: withKeys(currentTabState.providedChunkKeys, context.novelChunkKeys),
    cumulativeSchemaTokens: currentTabState.cumulativeSchemaTokens + context.novelDdlTokens,
    providedMemoryIds: withKeys(
      currentTabState.providedMemoryIds,
      context.novelMemories.map((memory) => memoryKey(memory))
    ),
  })
}

export async function applyCurrentTurnContext(
  tabId: string,
  connectionId: string,
  turn: { userMessage: AiMessage; attachedContext: AttachedContext | null }
): Promise<void> {
  const context = await retrieveSchemaContext(tabId, connectionId, turn.userMessage.content)
  if (!useAiStore.getState().tabs[tabId]) return

  ensureBaseSystemPrompt(tabId, AI_SYSTEM_PROMPT)
  appendNovelContextMessages(tabId, turn.userMessage.id, context)
  syncAttachedContextMessage(tabId, turn.userMessage.id, turn.attachedContext)
  recordProvidedContext(tabId, context)
}
