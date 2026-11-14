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

export function useFetchModels(url: string): UseFetchModelsResult {
  const [models, setModels] = useState<AiModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCounterRef = useRef(0)

  const isSupersededRequest = useCallback(
    (requestNumber: number) => requestNumber !== fetchCounterRef.current,
    []
  )

  const fetch = useCallback(async () => {
    if (!url.trim()) return
    const thisRequest = ++fetchCounterRef.current
    setLoading(true)
    setError(null)
    setModels([])
    try {
      const result = await listAiModels(url)
      if (isSupersededRequest(thisRequest)) return
      if (result.error) {
        setError(result.error)
      }
      const foundNoModels = result.models.length === 0 && !result.error
      if (foundNoModels) {
        setError('No models found at this endpoint.')
        return
      }
      setModels(result.models)
    } catch (error) {
      if (isSupersededRequest(thisRequest)) return
      setError(error instanceof Error ? error.message : 'Failed to fetch models')
    } finally {
      if (!isSupersededRequest(thisRequest)) {
        setLoading(false)
      }
    }
  }, [url, isSupersededRequest])

  const reset = useCallback(() => {
    fetchCounterRef.current++
    setLoading(false)
    setError(null)
    setModels([])
  }, [])

  return { models, loading, error, fetch, reset }
}
