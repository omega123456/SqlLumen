import { useCallback, useEffect, useState } from 'react'
import { useConnectionStore } from '../../../stores/connection-store'
import { logFrontend } from '../../../lib/app-log-commands'
import { EMPTY_MEMORY_STORE, loadAllMemories, type MemoryStore } from './memory-store'

function useHydratedConnections() {
  const savedConnections = useConnectionStore((state) => state.savedConnections)
  const connectionGroups = useConnectionStore((state) => state.connectionGroups)
  const fetchSavedConnections = useConnectionStore((state) => state.fetchSavedConnections)
  useEffect(() => {
    const hasNoConnectionData = savedConnections.length === 0 && connectionGroups.length === 0
    if (hasNoConnectionData) {
      void fetchSavedConnections()
    }
  }, [savedConnections.length, connectionGroups.length, fetchSavedConnections])
  return { savedConnections, connectionGroups }
}

export function useMemoryStore() {
  const { savedConnections, connectionGroups } = useHydratedConnections()
  const [memories, setMemories] = useState<MemoryStore>(EMPTY_MEMORY_STORE)
  const [loading, setLoading] = useState(true)

  const loadMemories = useCallback(async () => {
    try {
      setMemories(await loadAllMemories(connectionGroups, savedConnections))
    } catch (error) {
      logFrontend('error', `[AiMemoriesSettings] Failed to load memories: ${String(error)}`)
    } finally {
      setLoading(false)
    }
  }, [savedConnections, connectionGroups])

  useEffect(() => {
    void loadMemories()
  }, [loadMemories])

  return { savedConnections, connectionGroups, memories, loading, loadMemories }
}
