import type { AiChunkKind } from '../../lib/ai-commands'
import type { AiMessage, AiStreamChunk, TabAiState } from '../ai-store'
import { callUnlistenSafely, ensureTab, patchTab, tabForActiveStream } from './ai-store-access'
import { canReuseResponsesChain } from './chat-actions'
import { findBaseSystemPrompt } from './context-messages'
import type { AiStreamDone } from './context-messages'
import { useAiStore } from '../ai-store'

export function activeRequestResetFragment(): Partial<TabAiState> {
  return {
    isGenerating: false,
    activeStreamId: null,
    activeRequestEndpoint: '',
    activeRequestModel: '',
    activeStreamHasAssistantOutput: false,
  }
}

export function responseChainResetFragment(): Partial<TabAiState> {
  return {
    previousResponseId: null,
    lastCompletedSystemPrompt: '',
    lastCompletedTransport: null,
    lastCompletedEndpoint: '',
    lastCompletedModel: '',
  }
}

function mergeChunkIntoAssistantMessage(
  message: AiMessage,
  content: string,
  kind: AiChunkKind
): AiMessage {
  if (kind === 'thinking') {
    return { ...message, thinkingContent: (message.thinkingContent ?? '') + content }
  }
  return { ...message, content: message.content + content }
}

function assistantMessageFromChunk(content: string, kind: AiChunkKind): AiMessage {
  const message: AiMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: content,
    timestamp: Date.now(),
  }
  if (kind === 'thinking') {
    return { ...message, content: '', thinkingContent: content }
  }
  return message
}

function applyChunkToMessages(
  messages: AiMessage[],
  content: string,
  kind: AiChunkKind
): AiMessage[] {
  const updated = [...messages]
  const last = updated[updated.length - 1]
  if (last?.role === 'assistant') {
    updated[updated.length - 1] = mergeChunkIntoAssistantMessage(last, content, kind)
    return updated
  }
  updated.push(assistantMessageFromChunk(content, kind))
  return updated
}

function completedResponseChainFragment(tab: TabAiState, info: AiStreamDone): Partial<TabAiState> {
  const lastCompletedTransport = info.transport ?? null
  if (!canReuseResponsesChain(tab, info)) {
    return {
      previousResponseId: null,
      lastCompletedSystemPrompt: '',
      lastCompletedTransport: lastCompletedTransport,
      lastCompletedEndpoint: '',
      lastCompletedModel: '',
    }
  }
  return {
    previousResponseId: info.responseId ?? null,
    lastCompletedSystemPrompt: findBaseSystemPrompt(tab.messages),
    lastCompletedTransport: lastCompletedTransport,
    lastCompletedEndpoint: tab.activeRequestEndpoint,
    lastCompletedModel: tab.activeRequestModel,
  }
}

export function onStreamChunk(
  tabId: string,
  streamId: string,
  { content, kind }: AiStreamChunk
): void {
  const tab = tabForActiveStream(tabId, streamId)
  if (!tab) return

  const messages = applyChunkToMessages(tab.messages, content, kind)

  patchTab(tabId, {
    messages: messages,
    isGenerating: true,
    activeStreamId: streamId,
    ...(kind !== 'thinking' && { activeStreamHasAssistantOutput: true }),
  })
}

export function onStreamDone(
  tabId: string,
  streamId: string,
  info: { responseId?: string | null; transport?: 'chat_completions' | 'responses' }
): void {
  const tab = tabForActiveStream(tabId, streamId)
  if (!tab) return

  patchTab(tabId, {
    ...activeRequestResetFragment(),
    ...completedResponseChainFragment(tab, info),
  })

  callUnlistenSafely(tabId, tab)

  useAiStore.getState().restoreTabStatus(tabId)
}

export function onStreamError(tabId: string, streamId: string, error: string): void {
  const tab = tabForActiveStream(tabId, streamId)
  if (!tab) return

  patchTab(tabId, {
    ...activeRequestResetFragment(),
    ...responseChainResetFragment(),
    error,
  })

  callUnlistenSafely(tabId, tab)

  useAiStore.getState().restoreTabStatus(tabId)
}

export function setUnlisten(tabId: string, unlisten: () => void): void {
  ensureTab(tabId)
  patchTab(tabId, { _unlisten: unlisten })
}

export function aiStreamActions() {
  return { onStreamChunk, onStreamDone, onStreamError, setUnlisten }
}
