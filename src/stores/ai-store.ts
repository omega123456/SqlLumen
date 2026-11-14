import { create } from 'zustand'
import type { AiChunkKind } from '../lib/ai-commands'
import { aiChatActions } from './ai-store/chat-actions'
import { aiStreamActions } from './ai-store/stream-actions'
import { aiPanelActions } from './ai-store/panel-actions'
export { extractTablesFromSql } from './ai-store/expansion-parsing'

export interface AiMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  kind?: 'schema-context' | 'attached-context' | 'memory-context'
  thinkingContent?: string
  chunkKeys?: string[]
  memoryIds?: string[]
}

export interface AttachedContext {
  sql: string
  range: {
    startLineNumber: number
    endLineNumber: number
    startColumn: number
    endColumn: number
  }
}

export interface TabAiState {
  messages: AiMessage[]
  isGenerating: boolean
  activeStreamId: string | null
  previousResponseId?: string | null
  attachedContext: AttachedContext | null
  isPanelOpen: boolean
  error: string | null
  providedChunkKeys: Record<string, true>
  cumulativeSchemaTokens: number
  providedMemoryIds: Record<string, true>
  lastCompletedSystemPrompt: string
  lastCompletedTransport: 'chat_completions' | 'responses' | null
  lastCompletedEndpoint: string
  lastCompletedModel: string
  activeRequestEndpoint: string
  activeRequestModel: string
  activeStreamHasAssistantOutput: boolean
  isWaitingForIndex: boolean
  connectionId: string | null
  _unlisten: (() => void) | null
}

export function createDefaultTabAiState(): TabAiState {
  return {
    messages: [],
    isGenerating: false,
    activeStreamId: null,
    previousResponseId: null,
    attachedContext: null,
    isPanelOpen: false,
    error: null,
    providedChunkKeys: {},
    cumulativeSchemaTokens: 0,
    providedMemoryIds: {},
    lastCompletedSystemPrompt: '',
    lastCompletedTransport: null,
    lastCompletedEndpoint: '',
    lastCompletedModel: '',
    activeRequestEndpoint: '',
    activeRequestModel: '',
    activeStreamHasAssistantOutput: false,
    isWaitingForIndex: false,
    connectionId: null,
    _unlisten: null,
  }
}

export interface AiRequestSettings {
  temperature?: number
  maxTokens?: number
  model?: string
}

export interface AiMessageSend {
  connectionId: string
  message: string
  settings: AiRequestSettings
}

export interface AiStreamChunk {
  content: string
  kind: AiChunkKind
}

export interface AiEndpointModel {
  endpoint: string
  model: string
}

export interface AiState {
  tabs: Record<string, TabAiState>

  sendMessage: (tabId: string, send: AiMessageSend) => void
  cancelStream: (tabId: string) => void
  retryLastMessage: (tabId: string, connectionId: string, settings: AiRequestSettings) => void

  onStreamChunk: (tabId: string, streamId: string, chunk: AiStreamChunk) => void
  onStreamDone: (
    tabId: string,
    streamId: string,
    info: { responseId?: string | null; transport?: 'chat_completions' | 'responses' }
  ) => void
  onStreamError: (tabId: string, streamId: string, error: string) => void
  setUnlisten: (tabId: string, unlisten: () => void) => void

  togglePanel: (tabId: string) => void
  openPanel: (tabId: string) => void
  closePanel: (tabId: string) => void

  setAttachedContext: (tabId: string, context: AttachedContext) => void
  clearAttachedContext: (tabId: string) => void

  clearConversation: (tabId: string) => void
  setError: (tabId: string, error: string) => void
  clearError: (tabId: string) => void

  setAiReviewing: (tabId: string) => void
  restoreTabStatus: (tabId: string) => void

  cleanupTab: (tabId: string) => void
}

export const useAiStore = create<AiState>()(() => ({
  tabs: {},
  ...aiChatActions(),
  ...aiStreamActions(),
  ...aiPanelActions(),
}))
