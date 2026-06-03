import type { AiModelInfo } from '../../lib/ai-commands'

/** Models returned for the default chat endpoint. */
export const DEFAULT_AI_MODELS: AiModelInfo[] = [
  { id: 'codellama', category: 'chat' },
  { id: 'deepseek-coder', category: 'chat' },
  { id: 'llama3.2', category: 'chat' },
  { id: 'nomic-embed-text', category: 'embedding' },
  { id: 'mxbai-embed-large', category: 'embedding' },
]

/**
 * Distinct model set returned when a dedicated embedding endpoint is queried,
 * so E2E screenshots can demonstrate that the embedding URL drives a separate
 * Embedding Models grid.
 */
export const EMBEDDING_ENDPOINT_AI_MODELS: AiModelInfo[] = [
  { id: 'bge-large-en', category: 'embedding' },
  { id: 'gte-base', category: 'embedding' },
  { id: 'e5-mistral-7b', category: 'embedding' },
]

/** Endpoint URLs keyed to a distinct model set. */
export const AI_MODELS_BY_ENDPOINT: Record<string, AiModelInfo[]> = {
  'http://embeddings.local:8080/v1': EMBEDDING_ENDPOINT_AI_MODELS,
}
