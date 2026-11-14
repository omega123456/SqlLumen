import { useEffect, useMemo, useRef, useState } from 'react'
import type { DropdownOption } from '../../common/Dropdown'
import { listDatabases } from '../../../lib/schema-commands'
import { logFrontendError } from '../../../lib/app-log-commands'
import { toErrorMessage } from '../../../lib/error-message'
import { isConnectionOfProfile, useConnectionStore } from '../../../stores/connection-store'
import { showErrorToast } from '../../../stores/toast-store'
import {
  CLOSED_TARGET_NOTICE,
  EMPTY_TARGET_LISTING,
  EMPTY_TARGET_SELECTION,
  NEW_DB_SENTINEL,
  isOutsideSourceHost,
  normalizeHost,
  withDefaultDatabase,
  type TargetDatabaseListing,
  type TargetSelection,
} from './copy-to-host-model'

interface CopyTargetSource {
  sourceConnectionId: string
  sourceDatabase: string
}

interface TargetDatabasesRequest {
  targetConnectionId: string
  activeTargetSessionId: string | null
  sourceDatabase: string
}

function useTargetDatabaseListing(
  request: TargetDatabasesRequest,
  setTargetSelection: (update: (previous: TargetSelection) => TargetSelection) => void
): TargetDatabaseListing {
  const { targetConnectionId, activeTargetSessionId, sourceDatabase } = request
  const [targetListing, setTargetListing] = useState<TargetDatabaseListing>(EMPTY_TARGET_LISTING)
  useEffect(() => {
    let cancelled = false
    const loadDatabases = async () => {
      if (!targetConnectionId) {
        setTargetListing(EMPTY_TARGET_LISTING)
        return
      }
      if (!activeTargetSessionId) {
        setTargetListing({ databases: [], notice: CLOSED_TARGET_NOTICE })
        return
      }
      try {
        const databases = await listDatabases(activeTargetSessionId)
        if (cancelled) return
        setTargetListing({ databases: databases, notice: null })
        if (databases.includes(sourceDatabase)) {
          setTargetSelection((previous) => withDefaultDatabase(previous, sourceDatabase))
        }
      } catch (error) {
        if (cancelled) return
        const message = toErrorMessage(error)
        setTargetListing(EMPTY_TARGET_LISTING)
        logFrontendError('[copy-to-host] Failed to load target databases:', message)
        showErrorToast(`Failed to load target databases: ${message}`)
      }
    }
    void loadDatabases()
    return () => {
      cancelled = true
    }
  }, [targetConnectionId, activeTargetSessionId, sourceDatabase, setTargetSelection])
  return targetListing
}

function targetDatabaseOptionsFor(databases: string[]): DropdownOption[] {
  return [
    { value: '', label: 'Select a database…' },
    ...databases.map((database) => ({ value: database, label: database })),
    {
      value: NEW_DB_SENTINEL,
      label: '+ New database…',
      description: 'Create a new database on the target',
    },
  ]
}

function useTargetHosts(sourceConnectionId: string, targetConnectionId: string) {
  const savedConnections = useConnectionStore((state) => state.savedConnections)
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const sourceHost = useMemo(
    () => normalizeHost(activeConnections[sourceConnectionId]?.profile.host),
    [activeConnections, sourceConnectionId]
  )
  const activeTargetSessionId = useMemo(() => {
    if (!targetConnectionId) return null
    const active = Object.values(activeConnections).find((connection) =>
      isConnectionOfProfile(connection, targetConnectionId)
    )
    return active?.id ?? null
  }, [activeConnections, targetConnectionId])
  const connectionOptions = useMemo<DropdownOption[]>(() => {
    const options = savedConnections
      .filter((connection) => !connection.readOnly)
      .filter((connection) => isOutsideSourceHost(connection.host, sourceHost))
      .map((connection) => ({
        value: connection.id,
        label: connection.name,
        description: `${connection.host}:${connection.port}`,
      }))
    return [{ value: '', label: 'Select a connection…' }, ...options]
  }, [savedConnections, sourceHost])
  const isSameHost = useMemo(() => {
    if (!targetConnectionId) return false
    if (sourceHost === null) return false
    const target = savedConnections.find((connection) => connection.id === targetConnectionId)
    const targetHost = normalizeHost(target?.host)
    return targetHost === sourceHost
  }, [savedConnections, targetConnectionId, sourceHost])
  return { activeTargetSessionId, connectionOptions, isSameHost }
}

function effectiveDatabaseName(selection: TargetSelection): string {
  if (selection.databaseValue === NEW_DB_SENTINEL) return selection.newDatabaseName.trim()
  return selection.databaseValue
}

export function useCopyTarget({ sourceConnectionId, sourceDatabase }: CopyTargetSource) {
  const [targetSelection, setTargetSelection] = useState<TargetSelection>(EMPTY_TARGET_SELECTION)
  const { connectionId, databaseValue } = targetSelection
  const hosts = useTargetHosts(sourceConnectionId, connectionId)
  const listing = useTargetDatabaseListing(
    {
      targetConnectionId: connectionId,
      activeTargetSessionId: hosts.activeTargetSessionId,
      sourceDatabase: sourceDatabase,
    },
    setTargetSelection
  )
  const newDatabaseInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (databaseValue === NEW_DB_SENTINEL) newDatabaseInputRef.current?.focus()
  }, [databaseValue])
  const databaseOptions = useMemo(
    () => targetDatabaseOptionsFor(listing.databases),
    [listing.databases]
  )
  return {
    targetSelection: targetSelection,
    setTargetSelection: setTargetSelection,
    newDatabaseInputRef: newDatabaseInputRef,
    connectionOptions: hosts.connectionOptions,
    databaseOptions: databaseOptions,
    notice: listing.notice,
    isSameHost: hosts.isSameHost,
    effectiveTargetDatabase: effectiveDatabaseName(targetSelection),
  }
}
