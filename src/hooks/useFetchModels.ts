import { useCallback, useRef, useState } from 'react'
import { listAiModels } from '../lib/ai-commands'
import type { AiModelInfo } from '../lib/ai-commands'

export interface UseFetchModelsResult {
  models: AiModelInfo[]
  loading: boolean
  error: string | null
  fetch: () => Promise<void>
  reset: () => void
}

/**
 * Fetches the available AI models for a given OpenAI-compatible base URL.
 *
 * Owns its own state plus a stale-request counter so overlapping fetches (for
 * example when the URL changes mid-flight) cannot clobber each other: every
 * fetch captures the counter value when it starts and only commits its result
 * if the counter has not advanced. `reset` bumps the same counter to invalidate
 * any in-flight request and clears state — used when the URL becomes blank.
 */
export function useFetchModels(url: string): UseFetchModelsResult {
  const [models, setModels] = useState<AiModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCounterRef = useRef(0)

  const fetch = useCallback(async () => {
    if (!url.trim()) return
    const thisRequest = ++fetchCounterRef.current
    setLoading(true)
    setError(null)
    setModels([])
    try {
      const result = await listAiModels(url)
      if (thisRequest !== fetchCounterRef.current) return // stale
      if (result.error) {
        setError(result.error)
      }
      if (result.models.length === 0 && !result.error) {
        setError('No models found at this endpoint.')
      } else {
        setModels(result.models)
      }
    } catch (err) {
      if (thisRequest !== fetchCounterRef.current) return // stale
      setError(err instanceof Error ? err.message : 'Failed to fetch models')
    } finally {
      if (thisRequest === fetchCounterRef.current) {
        setLoading(false)
      }
    }
  }, [url])

  const reset = useCallback(() => {
    fetchCounterRef.current++
    setLoading(false)
    setError(null)
    setModels([])
  }, [])

  return { models, loading, error, fetch, reset }
}
