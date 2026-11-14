import { useEffect } from 'react'
import { useSchemaIndexStore, type ConnectionIndexState } from '../../../stores/schema-index-store'
import type { ModelFetch } from './ai-settings-model'

export function useBuildingConnections(): ConnectionIndexState[] {
  const connections = useSchemaIndexStore((state) => state.connections)
  return Object.values(connections).filter((indexState) => indexState.status === 'building')
}

export function useModelFetchOnEndpoint(modelFetch: ModelFetch, isFetchEnabled: boolean): void {
  const fetchModels = modelFetch.fetch
  const resetModels = modelFetch.reset
  useEffect(() => {
    if (!isFetchEnabled) {
      resetModels()
      return
    }
    fetchModels()
  }, [isFetchEnabled, fetchModels, resetModels])
}

export function useChatModelFetchOnEndpoint(modelFetch: ModelFetch, isFetchEnabled: boolean): void {
  const fetchModels = modelFetch.fetch
  useEffect(() => {
    if (isFetchEnabled) {
      fetchModels()
    }
  }, [isFetchEnabled, fetchModels])
}
