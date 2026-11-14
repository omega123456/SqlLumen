import { useCallback, useEffect, useState } from 'react'
import { listExportableObjects, type ExportableDatabase } from '../../../lib/sql-dump-commands'
import { logFrontendError } from '../../../lib/app-log-commands'
import { toErrorMessage } from '../../../lib/error-message'
import {
  buildInitialTableSelection,
  toggleDatabaseSelection,
  toggleTableSelection,
  type TableSelection,
} from '../sql-dump-selection'

export interface DumpObjectsInputs {
  connectionId: string
  initialDatabase: string | undefined
  initialTable: string | undefined
}

export function useDumpObjects({ connectionId, initialDatabase, initialTable }: DumpObjectsInputs) {
  const [databases, setDatabases] = useState<ExportableDatabase[]>([])
  const [loadingObjects, setLoadingObjects] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedTables, setSelectedTables] = useState<TableSelection>({})

  useEffect(() => {
    let cancelled = false

    const loadObjects = async () => {
      setLoadingObjects(true)
      setLoadError(null)
      try {
        const loadedDatabases = await listExportableObjects(connectionId)
        if (cancelled) return
        setDatabases(loadedDatabases)
        setSelectedTables(
          buildInitialTableSelection({
            databases: loadedDatabases,
            initialDatabase: initialDatabase,
            initialTable: initialTable,
          })
        )
      } catch (error) {
        if (cancelled) return
        const message = toErrorMessage(error)
        setLoadError(message)
        logFrontendError('[sql-dump] Failed to load exportable objects:', message)
      } finally {
        if (!cancelled) setLoadingObjects(false)
      }
    }

    void loadObjects()

    return () => {
      cancelled = true
    }
  }, [connectionId, initialDatabase, initialTable])

  const toggleTable = useCallback((dbName: string, tableName: string) => {
    setSelectedTables((previous) => toggleTableSelection(previous, dbName, tableName))
  }, [])

  const toggleDatabase = useCallback(
    (dbName: string) => {
      const database = databases.find((candidate) => candidate.name === dbName)
      if (!database) return
      setSelectedTables((previous) => toggleDatabaseSelection(previous, database))
    },
    [databases]
  )

  return {
    databases: databases,
    loadingObjects: loadingObjects,
    loadError: loadError,
    selectedTables: selectedTables,
    toggleTable: toggleTable,
    toggleDatabase: toggleDatabase,
  }
}
