import { useEffect, useState } from 'react'
import {
  getCache,
  getPendingLoad,
  getSearchableObjects,
  loadCache,
} from '../query-editor/schema-metadata-cache'
import { getPendingBootstrap } from '../../lib/schema-cache-bootstrap'
import type { SearchableObject } from '../../types/schema'

function isSchemaCachePending(connectionId: string | null): boolean {
  if (connectionId === null) return false
  return getCache(connectionId).status !== 'ready'
}

function readSearchableObjects(connectionId: string | null): SearchableObject[] {
  return connectionId ? getSearchableObjects(connectionId) : []
}

function readSortedDatabases(connectionId: string | null): string[] {
  if (!connectionId) return []
  return [...getCache(connectionId).databases].sort((left, right) => left.localeCompare(right))
}

function pendingSchemaLoad(connectionId: string): Promise<unknown> | null {
  const inFlightLoad = getPendingLoad(connectionId) ?? getPendingBootstrap(connectionId)
  if (inFlightLoad) return inFlightLoad
  return getCache(connectionId).status === 'ready' ? null : loadCache(connectionId)
}

export interface PaletteSchemaObjects {
  searchableObjects: SearchableObject[]
  databases: string[]
  isLoading: boolean
}

export function usePaletteSchemaObjects(activeConnectionId: string | null): PaletteSchemaObjects {
  const [searchableObjects, setSearchableObjects] = useState<SearchableObject[]>(() =>
    readSearchableObjects(activeConnectionId)
  )
  const [databases, setDatabases] = useState<string[]>(() =>
    readSortedDatabases(activeConnectionId)
  )
  const [isLoading, setIsLoading] = useState(() => isSchemaCachePending(activeConnectionId))

  useEffect(() => {
    if (!activeConnectionId) {
      return
    }
    const pendingLoad = pendingSchemaLoad(activeConnectionId)
    if (!pendingLoad) {
      return
    }
    let cancelled = false
    const refresh = () => {
      if (cancelled) {
        return
      }
      setSearchableObjects(getSearchableObjects(activeConnectionId))
      setDatabases(readSortedDatabases(activeConnectionId))
      setIsLoading(false)
    }
    pendingLoad.then(refresh, refresh)
    return () => {
      cancelled = true
    }
  }, [activeConnectionId])

  return { searchableObjects, databases, isLoading }
}
