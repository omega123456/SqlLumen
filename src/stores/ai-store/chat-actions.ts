import { sendAiChat, cancelAiStream, listenToAiStream } from '../../lib/ai-commands'
import type { AiMessage as IpcAiMessage } from '../../lib/ai-commands'
import { useSettingsStore } from '../settings-store'
import { useQueryStore } from '../query-store'
import { logFrontend } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import type {
  AiEndpointModel,
  AiMessage,
  AiMessageSend,
  AiRequestSettings,
  AttachedContext,
  TabAiState,
} from '../ai-store'
import { callUnlistenSafely, ensureTab, isActiveStream, patchTab } from './ai-store-access'
import {
  collectRemovedContextIds,
  findRemovableTurnContextIndices,
  isPromptOnlyContextMessage,
  withoutKeys,
} from './context-messages'
import type { AiStreamDone } from './context-messages'
import { sumSchemaContextTokens } from './ddl-selection'
import { activeRequestResetFragment, responseChainResetFragment } from './stream-actions'
import { applyCurrentTurnContext, getCurrentSystemPrompt } from './turn-context'
import { useAiStore } from '../ai-store'

export const AI_SYSTEM_PROMPT = `You are an expert SQL assistant integrated into a database client. You help users:
- Write SQL queries from natural language descriptions
- Explain what existing SQL queries do
- Optimize queries for better performance
- Debug SQL issues and suggest fixes
- Answer general SQL and database questions

The application may inject additional context messages containing relevant schema, SQL, or user-note context.

Schema context is cumulative across the conversation: all schema-context messages in this conversation are authoritative and should be used together. When the same table appears in multiple schema-context messages, the most recent version takes precedence.

Retrieved tables only:
- Use only tables that are present in the retrieved schema context.
- Never make up or reference any table that is not in the retrieved schema.
- Always use database-qualified table names in generated SQL (\`db\`.\`table\`).

Note: Approximate row counts are included in the schema metadata where available.

User notes (memories) may also appear in separate memory-context messages throughout the conversation. Use them to inform your responses.

Always write SQL that is compatible with MySQL/MariaDB syntax.

Whenever you reference a table in generated SQL, always use its full database-qualified name (for example, \`database_name\`.\`table_name\`).

When writing SQL, prefer clear, readable queries. Format your SQL code in markdown code blocks with the sql language tag.`

const DEFAULT_TEMPERATURE = 0.3

const DEFAULT_MAX_TOKENS = 2048

function shouldReuseResponseChain(
  tab: TabAiState | undefined,
  systemPrompt: string | undefined,
  { endpoint, model }: AiEndpointModel
): boolean {
  if (!tab?.previousResponseId) return false
  if (!systemPrompt) return false

  return (
    tab.lastCompletedTransport === 'responses' &&
    tab.lastCompletedSystemPrompt === systemPrompt &&
    tab.lastCompletedEndpoint === endpoint &&
    tab.lastCompletedModel === model
  )
}

export function getAiSetting(key: string): string {
  const settingsState = useSettingsStore.getState() as {
    getEffectiveSetting?: (settingKey: string) => string
    getSetting?: (settingKey: string) => string
  }

  if (typeof settingsState.getEffectiveSetting === 'function') {
    return settingsState.getEffectiveSetting(key)
  }

  if (typeof settingsState.getSetting === 'function') {
    return settingsState.getSetting(key)
  }

  return ''
}

function resolveTemperature(override: number | undefined): number {
  const temperature = override ?? parseFloat(getAiSetting('ai.temperature'))
  return isNaN(temperature) ? DEFAULT_TEMPERATURE : temperature
}

function resolveMaxTokens(override: number | undefined): number {
  const maxTokens = override ?? parseInt(getAiSetting('ai.maxTokens'), 10)
  return isNaN(maxTokens) ? DEFAULT_MAX_TOKENS : maxTokens
}

function isUserTypedMessage(message: AiMessage): boolean {
  return message.role === 'user' && !isPromptOnlyContextMessage(message)
}

function findLastUserMessage(messages: AiMessage[]): AiMessage | undefined {
  return [...messages].reverse().find(isUserTypedMessage)
}

export function canReuseResponsesChain(tab: TabAiState, info: AiStreamDone): boolean {
  const hasResponseId = (info.responseId?.trim().length ?? 0) > 0
  return info.transport === 'responses' && tab.activeStreamHasAssistantOutput && hasResponseId
}

function buildSendAiChatPayload(
  tabId: string,
  streamId: string,
  settings: AiRequestSettings
): Parameters<typeof sendAiChat>[0] {
  const endpoint = getAiSetting('ai.endpoint')
  const model = settings.model ?? getAiSetting('ai.model')
  const enableReasoning = getAiSetting('ai.enableReasoning') !== 'false'
  const preferResponsesApi = getAiSetting('ai.preferResponsesApi') === 'true'

  patchTab(tabId, {
    activeRequestEndpoint: endpoint,
    activeRequestModel: model,
  })

  const tab = useAiStore.getState().tabs[tabId]
  const currentSystemPrompt = getCurrentSystemPrompt(tabId)
  const ipcMessages: IpcAiMessage[] = (tab?.messages ?? []).map((message) => ({
    role: message.role,
    content: message.content,
  }))
  const reusesResponseChain = shouldReuseResponseChain(tab, currentSystemPrompt, {
    endpoint: endpoint,
    model: model,
  })

  return {
    messages: ipcMessages,
    endpoint: endpoint,
    model: model,
    temperature: resolveTemperature(settings.temperature),
    maxTokens: resolveMaxTokens(settings.maxTokens),
    streamId: streamId,
    previousResponseId: reusesResponseChain ? (tab?.previousResponseId ?? null) : null,
    preferResponsesApi: preferResponsesApi,
    enableReasoning: enableReasoning,
  }
}

function isRetryOfFailedUserMessage(tab: TabAiState, trimmedMessage: string): boolean {
  const lastMessage = tab.messages[tab.messages.length - 1]
  return (
    !tab.isGenerating &&
    !!tab.error &&
    lastMessage?.role === 'user' &&
    lastMessage.content.trim() === trimmedMessage
  )
}

function messagesWithUserMessage(tab: TabAiState, userMessage: AiMessage): AiMessage[] {
  if (isRetryOfFailedUserMessage(tab, userMessage.content.trim())) {
    return [...tab.messages.slice(0, -1), userMessage]
  }
  return [...tab.messages, userMessage]
}

interface AiStreamStart {
  tabId: string
  streamId: string
  connectionId: string
  userMessage: AiMessage
  attachedContext: AttachedContext | null
  settings: AiRequestSettings
}

function failAiStream(tabId: string, error: unknown): void {
  const errorMessage = toErrorMessage(error)
  logFrontend('error', `[ai-store] AI chat failed: ${errorMessage}`)
  const tab = useAiStore.getState().tabs[tabId]
  if (!tab) return
  callUnlistenSafely(tabId, tab)
  patchTab(tabId, {
    ...activeRequestResetFragment(),
    error: errorMessage,
  })
  useAiStore.getState().restoreTabStatus(tabId)
}

async function startAiStream(start: AiStreamStart): Promise<void> {
  const { tabId, streamId, connectionId, userMessage, attachedContext, settings } = start
  try {
    await applyCurrentTurnContext(tabId, connectionId, {
      userMessage: userMessage,
      attachedContext: attachedContext,
    })
    if (!isActiveStream(tabId, streamId)) return

    const unlisten = await listenToAiStream(streamId, {
      onChunk: (content, kind) =>
        useAiStore.getState().onStreamChunk(tabId, streamId, { content: content, kind: kind }),
      onDone: (info) => useAiStore.getState().onStreamDone(tabId, streamId, info),
      onError: (error) => useAiStore.getState().onStreamError(tabId, streamId, error),
    })

    if (!isActiveStream(tabId, streamId)) {
      unlisten()
      return
    }

    useAiStore.getState().setUnlisten(tabId, unlisten)
    await sendAiChat(buildSendAiChatPayload(tabId, streamId, settings))
  } catch (error) {
    failAiStream(tabId, error)
  }
}

export function sendMessage(
  tabId: string,
  { connectionId, message, settings }: AiMessageSend
): void {
  ensureTab(tabId)

  const tab = useAiStore.getState().tabs[tabId]
  const streamId = crypto.randomUUID()
  const userMessage: AiMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: message,
    timestamp: Date.now(),
  }

  patchTab(tabId, {
    messages: messagesWithUserMessage(tab, userMessage),
    error: null,
    isGenerating: true,
    activeStreamId: streamId,
    connectionId: connectionId,
    previousResponseId: tab.previousResponseId,
    activeRequestEndpoint: '',
    activeRequestModel: '',
    activeStreamHasAssistantOutput: false,
  })

  useQueryStore.getState().setTabStatus(tabId, 'ai-pending')

  void startAiStream({
    tabId: tabId,
    streamId: streamId,
    connectionId: connectionId,
    userMessage: userMessage,
    attachedContext: tab.attachedContext,
    settings: settings,
  })
}

export function cancelStream(tabId: string): void {
  ensureTab(tabId)
  const tab = useAiStore.getState().tabs[tabId]
  const streamId = tab.activeStreamId
  if (!streamId) return

  patchTab(tabId, {
    ...activeRequestResetFragment(),
    ...responseChainResetFragment(),
  })

  useAiStore.getState().restoreTabStatus(tabId)

  callUnlistenSafely(tabId, tab)

  cancelAiStream(streamId).catch((error) => {
    const errorMessage = toErrorMessage(error)
    logFrontend('warn', `[ai-store] AI cancel failed: ${errorMessage}`)
  })
}

export function retryLastMessage(
  tabId: string,
  connectionId: string,
  settings: AiRequestSettings
): void {
  const tab = useAiStore.getState().tabs[tabId]
  if (!tab) return

  const lastUserMessage = findLastUserMessage(tab.messages)
  if (!lastUserMessage) return

  const lastUserIndex = tab.messages.lastIndexOf(lastUserMessage)
  const indicesToRemove = findRemovableTurnContextIndices(tab.messages, lastUserIndex)
  const removed = collectRemovedContextIds(tab.messages, indicesToRemove)
  const removeSet = new Set(indicesToRemove)
  const isKeptBeforeLastUser = (_: AiMessage, index: number): boolean =>
    !removeSet.has(index) && index < lastUserIndex
  const remainingMessages = tab.messages.filter(isKeptBeforeLastUser)

  patchTab(tabId, {
    ...activeRequestResetFragment(),
    ...responseChainResetFragment(),
    messages: remainingMessages,
    error: null,
    providedChunkKeys: withoutKeys(tab.providedChunkKeys, removed.chunkKeys),
    providedMemoryIds: withoutKeys(tab.providedMemoryIds, removed.memoryIds),
    cumulativeSchemaTokens: sumSchemaContextTokens(remainingMessages),
  })

  useAiStore.getState().sendMessage(tabId, {
    connectionId: connectionId,
    message: lastUserMessage.content,
    settings: settings,
  })
}

export function aiChatActions() {
  return { sendMessage, cancelStream, retryLastMessage }
}
