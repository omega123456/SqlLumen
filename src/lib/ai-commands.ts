import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AiChatParams {
  messages: AiMessage[]
  endpoint: string
  model: string
  temperature: number
  maxTokens: number
  streamId: string
}

export interface AiStreamCallbacks {
  onChunk: (content: string) => void
  onDone: () => void
  onError: (error: string) => void
}

export interface AiModelInfo {
  id: string
  name?: string
  category: string
}

// ---------------------------------------------------------------------------
// Event payload types (match Rust camelCase serde)
// ---------------------------------------------------------------------------

interface StreamChunkPayload {
  streamId: string
  content: string
}

interface StreamDonePayload {
  streamId: string
}

interface StreamErrorPayload {
  streamId: string
  error: string
}

// ---------------------------------------------------------------------------
// IPC wrappers
// ---------------------------------------------------------------------------

/**
 * Invoke the `ai_chat` Tauri command to start a streaming AI chat completion.
 * The command returns immediately; results arrive via events.
 */
export async function sendAiChat(params: AiChatParams): Promise<void> {
  return invoke<void>('ai_chat', {
    request: {
      messages: params.messages,
      endpoint: params.endpoint,
      model: params.model,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      streamId: params.streamId,
    },
  })
}

/**
 * Invoke the `ai_cancel` Tauri command to cancel an in-progress AI stream.
 */
export async function cancelAiStream(streamId: string): Promise<void> {
  return invoke<void>('ai_cancel', { streamId })
}

/**
 * Set up event listeners for a specific AI stream.
 *
 * Listens to `ai-stream-chunk`, `ai-stream-done`, and `ai-stream-error`
 * events and filters by `streamId`. Returns a single unlisten function
 * that tears down all three listeners.
 */
export async function listenToAiStream(
  streamId: string,
  callbacks: AiStreamCallbacks
): Promise<() => void> {
  const unlistenChunk = await listen<StreamChunkPayload>('ai-stream-chunk', (event) => {
    if (event.payload.streamId === streamId) {
      callbacks.onChunk(event.payload.content)
    }
  })

  const unlistenDone = await listen<StreamDonePayload>('ai-stream-done', (event) => {
    if (event.payload.streamId === streamId) {
      callbacks.onDone()
    }
  })

  const unlistenError = await listen<StreamErrorPayload>('ai-stream-error', (event) => {
    if (event.payload.streamId === streamId) {
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

/**
 * List available models from an OpenAI-compatible endpoint.
 * Returns a result object with the models array and an optional error string
 * if the request failed. The caller can display the error to the user.
 */
export async function listAiModels(endpoint: string): Promise<ListAiModelsResult> {
  try {
    const response = await invoke<{ models: AiModelInfo[] }>('list_ai_models', { endpoint })
    return { models: response.models }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error('[ai-commands] Failed to list AI models:', errorMsg)
    return { models: [], error: errorMsg }
  }
}

// ---------------------------------------------------------------------------
// Query expansion (non-streaming)
// ---------------------------------------------------------------------------

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

/**
 * Non-streaming query expansion via `ai_query_expand`.
 * Sends a system + user message pair and returns the assistant response text.
 */
export async function aiQueryExpand(req: AiQueryExpandRequest): Promise<AiQueryExpandResponse> {
  return invoke<AiQueryExpandResponse>('ai_query_expand', { req })
}
