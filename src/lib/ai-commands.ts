import { listen } from '@tauri-apps/api/event'

import { logFrontend } from './app-log-commands'
import { toErrorMessage } from './error-message'
import { invokeArgumentCommand } from './ipc/dispatch'

export type AiChunkKind = 'content' | 'thinking'

export interface AiMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AiChatRequest {
  messages: AiMessage[]
  endpoint: string
  model: string
  temperature: number
  maxTokens: number
  streamId: string
  previousResponseId: string | null
  preferResponsesApi: boolean
  enableReasoning: boolean
}

export interface AiChatParams {
  messages: AiMessage[]
  endpoint: string
  model: string
  temperature: number
  maxTokens: number
  streamId: string
  previousResponseId?: string | null
  preferResponsesApi?: boolean
  enableReasoning?: boolean
}

export interface AiStreamDoneInfo {
  responseId?: string | null
  transport?: 'chat_completions' | 'responses'
}

export interface AiStreamCallbacks {
  onChunk: (content: string, kind: AiChunkKind) => void
  onDone: (info: AiStreamDoneInfo) => void
  onError: (error: string) => void
}

export interface AiModelInfo {
  id: string
  name?: string
  category: string
}

interface StreamChunkPayload {
  streamId: string
  content: string
  kind?: AiChunkKind
}

interface StreamDonePayload {
  streamId: string
  responseId?: string | null
  transport?: 'chat_completions' | 'responses'
}

interface StreamErrorPayload {
  streamId: string
  error: string
}

function toAiChatRequest(params: AiChatParams): AiChatRequest {
  return {
    messages: params.messages,
    endpoint: params.endpoint,
    model: params.model,
    temperature: params.temperature,
    maxTokens: params.maxTokens,
    streamId: params.streamId,
    previousResponseId: params.previousResponseId ?? null,
    preferResponsesApi: params.preferResponsesApi ?? false,
    enableReasoning: params.enableReasoning ?? true,
  }
}

export async function sendAiChat(params: AiChatParams): Promise<void> {
  return invokeArgumentCommand({
    command: 'ai_chat',
    argument: { request: toAiChatRequest(params) },
  })
}

export async function cancelAiStream(streamId: string): Promise<void> {
  return invokeArgumentCommand({ command: 'ai_cancel', argument: { streamId } })
}

function isPayloadForStream(payload: { streamId: string }, streamId: string): boolean {
  return payload.streamId === streamId
}

export async function listenToAiStream(
  streamId: string,
  callbacks: AiStreamCallbacks
): Promise<() => void> {
  const unlistenChunk = await listen<StreamChunkPayload>('ai-stream-chunk', (event) => {
    if (isPayloadForStream(event.payload, streamId)) {
      callbacks.onChunk(event.payload.content, event.payload.kind ?? 'content')
    }
  })

  const unlistenDone = await listen<StreamDonePayload>('ai-stream-done', (event) => {
    if (isPayloadForStream(event.payload, streamId)) {
      callbacks.onDone({
        responseId: event.payload.responseId ?? null,
        transport: event.payload.transport,
      })
    }
  })

  const unlistenError = await listen<StreamErrorPayload>('ai-stream-error', (event) => {
    if (isPayloadForStream(event.payload, streamId)) {
      callbacks.onError(event.payload.error)
    }
  })

  return () => {
    unlistenChunk()
    unlistenDone()
    unlistenError()
  }
}

export interface ListAiModelsResult {
  models: AiModelInfo[]
  error?: string
}

export async function listAiModels(endpoint: string): Promise<ListAiModelsResult> {
  try {
    const response = await invokeArgumentCommand({
      command: 'list_ai_models',
      argument: { endpoint },
    })
    return { models: response.models }
  } catch (error) {
    const errorMessage = toErrorMessage(error)
    logFrontend('error', `[ai-commands] Failed to list AI models: ${errorMessage}`)
    return { models: [], error: errorMessage }
  }
}

export interface AiQueryExpandRequest {
  endpoint: string
  model: string
  systemPrompt: string
  userMessage: string
  conversationContext?: string
}

export interface AiQueryExpandResponse {
  text: string
}

export async function aiQueryExpand(request: AiQueryExpandRequest): Promise<AiQueryExpandResponse> {
  return invokeArgumentCommand({ command: 'ai_query_expand', argument: { req: request } })
}
