import { useState, useCallback } from 'react'
import { useSchemaStore } from '../stores/schema-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { useConnectionStore } from '../stores/connection-store'
import {
  dropDatabase,
  dropTable,
  truncateTable,
  renameDatabase,
  renameTable,
} from '../lib/schema-commands'
import { ConfirmDialog } from '../components/dialogs/ConfirmDialog'
import { CreateDatabaseDialog } from '../components/dialogs/CreateDatabaseDialog'
import { AlterDatabaseDialog } from '../components/dialogs/AlterDatabaseDialog'
import { RenameDialog } from '../components/dialogs/RenameDialog'
import { showErrorToast, showSuccessToast } from '../stores/toast-store'

const RENAME_DB_WARNING =
  'This operation will create a new database, move all tables, and drop the original. Only works for databases containing tables only (no views, procedures, functions, triggers, or events).'

export interface UseObjectBrowserActionsReturn {
  // Dialog open state (for conditional rendering checks if needed)
  createDbOpen: boolean
  alterDbOpen: boolean
  renameDbOpen: boolean

  // Context menu callbacks
  onCreateDatabase: () => void
  onAlterDatabase: (db: string) => void
  onRenameDatabase: (db: string) => void
  onDropDatabase: (db: string) => void
  onDropTable: (db: string, table: string) => void
  onTruncateTable: (db: string, table: string) => void
  onRenameTable: (db: string, table: string) => void

  // Rendered dialogs (JSX — render at bottom of ObjectBrowser)
  dialogs: React.ReactNode
}

export function useObjectBrowserActions(connectionId: string): UseObjectBrowserActionsReturn {
  const refreshAll = useSchemaStore((state) => state.refreshAll)
  const refreshDatabase = useSchemaStore((state) => state.refreshDatabase)
  const refreshCategory = useSchemaStore((state) => state.refreshCategory)
  const closeTabsByDatabase = useWorkspaceStore((state) => state.closeTabsByDatabase)
  const closeTabsByObject = useWorkspaceStore((state) => state.closeTabsByObject)
  const updateTabDatabase = useWorkspaceStore((state) => state.updateTabDatabase)
  const updateTabObject = useWorkspaceStore((state) => state.updateTabObject)

  // Dialog states
  const [createDbOpen, setCreateDbOpen] = useState(false)
  const [alterDbOpen, setAlterDbOpen] = useState(false)
  const [alterDbTarget, setAlterDbTarget] = useState<string | null>(null)
  const [renameDbOpen, setRenameDbOpen] = useState(false)
  const [renameDbTarget, setRenameDbTarget] = useState<string | null>(null)
  const [dropDbConfirm, setDropDbConfirm] = useState<{ name: string } | null>(null)
  const [dropTableConfirm, setDropTableConfirm] = useState<{
    db: string
    table: string
  } | null>(null)
  const [truncateTableConfirm, setTruncateTableConfirm] = useState<{
    db: string
    table: string
  } | null>(null)
  const [renameTableOpen, setRenameTableOpen] = useState<{
    db: string
    table: string
  } | null>(null)

  // Shared loading/error state for confirm dialogs
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  // Shared loading/error state for rename dialogs
  const [renameLoading, setRenameLoading] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  // ---------------------------------------------------------------------------
  // Context menu action callbacks
  // ---------------------------------------------------------------------------

  const onCreateDatabase = useCallback(() => {
    setCreateDbOpen(true)
  }, [])

  const onAlterDatabase = useCallback((dbName: string) => {
    setAlterDbTarget(dbName)
    setAlterDbOpen(true)
  }, [])

  const onRenameDatabase = useCallback((dbName: string) => {
    setRenameDbTarget(dbName)
    setRenameDbOpen(true)
    setRenameError(null)
    setRenameLoading(false)
  }, [])

  const onDropDatabase = useCallback((dbName: string) => {
    setDropDbConfirm({ name: dbName })
    setConfirmError(null)
    setConfirmLoading(false)
  }, [])

  const onDropTable = useCallback((db: string, table: string) => {
    setDropTableConfirm({ db, table })
    setConfirmError(null)
    setConfirmLoading(false)
  }, [])

  const onTruncateTable = useCallback((db: string, table: string) => {
    setTruncateTableConfirm({ db, table })
    setConfirmError(null)
    setConfirmLoading(false)
  }, [])

  const onRenameTable = useCallback((db: string, table: string) => {
    setRenameTableOpen({ db, table })
    setRenameError(null)
    setRenameLoading(false)
  }, [])

  // ---------------------------------------------------------------------------
  // Dialog confirm handlers
  // ---------------------------------------------------------------------------

  const handleCreateDbSuccess = useCallback(
    (name: string) => {
      showSuccessToast('Database created', name)
      setCreateDbOpen(false)
      void refreshAll(connectionId)
    },
    [connectionId, refreshAll]
  )

  const handleAlterDbSuccess = useCallback(() => {
    const dbName = alterDbTarget
    if (dbName) {
      showSuccessToast('Database updated', dbName)
    }
    setAlterDbOpen(false)
    setAlterDbTarget(null)
    if (dbName) {
      void refreshDatabase(connectionId, dbName)
    }
  }, [connectionId, alterDbTarget, refreshDatabase])

  const handleRenameDb = useCallback(
    async (newName: string) => {
      if (!renameDbTarget) return
      setRenameLoading(true)
      setRenameError(null)
      try {
        await renameDatabase(connectionId, renameDbTarget, newName)
        updateTabDatabase(connectionId, renameDbTarget, newName)
        // If the renamed database was the defaultDatabase, update it to the new name
        const defaultDb =
          useConnectionStore.getState().activeConnections[connectionId]?.profile.defaultDatabase
        if (defaultDb === renameDbTarget) {
          void useConnectionStore.getState().updateDefaultDatabase(connectionId, newName)
        }
        setRenameDbOpen(false)
        setRenameDbTarget(null)
        void refreshAll(connectionId)
        showSuccessToast('Database renamed', `${renameDbTarget} → ${newName}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setRenameError(msg)
        showErrorToast('Failed to rename database', msg)
      } finally {
        setRenameLoading(false)
      }
    },
    [connectionId, renameDbTarget, refreshAll, updateTabDatabase]
  )

  const handleDropDb = useCallback(async () => {
    if (!dropDbConfirm) return
    setConfirmLoading(true)
    setConfirmError(null)
    try {
      const droppedName = dropDbConfirm.name
      await dropDatabase(connectionId, droppedName)
      closeTabsByDatabase(connectionId, droppedName)
      // If the dropped database was the defaultDatabase, clear it
      const defaultDb =
        useConnectionStore.getState().activeConnections[connectionId]?.profile.defaultDatabase
      if (defaultDb === droppedName) {
        void useConnectionStore.getState().updateDefaultDatabase(connectionId, null)
      }
      setDropDbConfirm(null)
      void refreshAll(connectionId)
      showSuccessToast('Database dropped', droppedName)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setConfirmError(msg)
      showErrorToast('Failed to drop database', msg)
    } finally {
      setConfirmLoading(false)
    }
  }, [connectionId, dropDbConfirm, closeTabsByDatabase, refreshAll])

  const handleDropTable = useCallback(async () => {
    if (!dropTableConfirm) return
    setConfirmLoading(true)
    setConfirmError(null)
    try {
      await dropTable(connectionId, dropTableConfirm.db, dropTableConfirm.table)
      closeTabsByObject(connectionId, dropTableConfirm.db, dropTableConfirm.table)
      const { db, table } = dropTableConfirm
      setDropTableConfirm(null)
      void refreshCategory(connectionId, db, 'table')
      showSuccessToast('Table dropped', `${db}.${table}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setConfirmError(msg)
      showErrorToast('Failed to drop table', msg)
    } finally {
      setConfirmLoading(false)
    }
  }, [connectionId, dropTableConfirm, closeTabsByObject, refreshCategory])

  const handleTruncateTable = useCallback(async () => {
    if (!truncateTableConfirm) return
    setConfirmLoading(true)
    setConfirmError(null)
    try {
      await truncateTable(connectionId, truncateTableConfirm.db, truncateTableConfirm.table)
      const db = truncateTableConfirm.db
      const tbl = truncateTableConfirm.table
      setTruncateTableConfirm(null)
      void refreshCategory(connectionId, db, 'table')
      showSuccessToast('Table truncated', `${db}.${tbl}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setConfirmError(msg)
      showErrorToast('Failed to truncate table', msg)
    } finally {
      setConfirmLoading(false)
    }
  }, [connectionId, truncateTableConfirm, refreshCategory])

  const handleRenameTable = useCallback(
    async (newName: string) => {
      if (!renameTableOpen) return
      setRenameLoading(true)
      setRenameError(null)
      try {
        await renameTable(connectionId, renameTableOpen.db, renameTableOpen.table, newName)
        updateTabObject(connectionId, renameTableOpen.db, renameTableOpen.table, newName)
        const db = renameTableOpen.db
        const prev = renameTableOpen.table
        setRenameTableOpen(null)
        void refreshCategory(connectionId, db, 'table')
        showSuccessToast('Table renamed', `${prev} → ${newName}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setRenameError(msg)
        showErrorToast('Failed to rename table', msg)
      } finally {
        setRenameLoading(false)
      }
    },
    [connectionId, renameTableOpen, updateTabObject, refreshCategory]
  )

  // ---------------------------------------------------------------------------
  // Rendered dialogs
  // ---------------------------------------------------------------------------

  const dialogs = (
    <>
      {/* Database dialogs */}
      {createDbOpen && (
        <CreateDatabaseDialog
          isOpen
          connectionId={connectionId}
          onSuccess={handleCreateDbSuccess}
          onCancel={() => setCreateDbOpen(false)}
        />
      )}

      {alterDbOpen && alterDbTarget && (
        <AlterDatabaseDialog
          isOpen
          connectionId={connectionId}
          databaseName={alterDbTarget}
          onSuccess={handleAlterDbSuccess}
          onCancel={() => {
            setAlterDbOpen(false)
            setAlterDbTarget(null)
          }}
        />
      )}

      {renameDbOpen && renameDbTarget && (
        <RenameDialog
          isOpen
          title="Rename Database"
          currentName={renameDbTarget}
          warning={RENAME_DB_WARNING}
          isLoading={renameLoading}
          error={renameError}
          onConfirm={handleRenameDb}
          onCancel={() => {
            setRenameDbOpen(false)
            setRenameDbTarget(null)
          }}
        />
      )}

      {dropDbConfirm && (
        <ConfirmDialog
          isOpen
          title="Drop Database"
          message={
            <>
              Are you sure you want to drop database <strong>{dropDbConfirm.name}</strong>?
            </>
          }
          confirmLabel="Drop Database"
          isDestructive
          isLoading={confirmLoading}
          error={confirmError}
          onConfirm={handleDropDb}
          onCancel={() => setDropDbConfirm(null)}
        />
      )}

      {/* Table dialogs */}
      {dropTableConfirm && (
        <ConfirmDialog
          isOpen
          title="Drop Table"
          message={
            <>
              Are you sure you want to drop table{' '}
              <strong>
                {dropTableConfirm.db}.{dropTableConfirm.table}
              </strong>
              ?
            </>
          }
          confirmLabel="Drop Table"
          isDestructive
          isLoading={confirmLoading}
          error={confirmError}
          onConfirm={handleDropTable}
          onCancel={() => setDropTableConfirm(null)}
        />
      )}

      {truncateTableConfirm && (
        <ConfirmDialog
          isOpen
          title="Truncate Table"
          message={
            <>
              Are you sure you want to truncate table{' '}
              <strong>
                {truncateTableConfirm.db}.{truncateTableConfirm.table}
              </strong>
              ? All data will be deleted.
            </>
          }
          confirmLabel="Truncate Table"
          isDestructive
          isLoading={confirmLoading}
          error={confirmError}
          onConfirm={handleTruncateTable}
          onCancel={() => setTruncateTableConfirm(null)}
        />
      )}

      {renameTableOpen && (
        <RenameDialog
          isOpen
          title="Rename Table"
          currentName={renameTableOpen.table}
          isLoading={renameLoading}
          error={renameError}
          onConfirm={handleRenameTable}
          onCancel={() => setRenameTableOpen(null)}
        />
      )}
    </>
  )

  return {
    createDbOpen,
    alterDbOpen,
    renameDbOpen,
    onCreateDatabase,
    onAlterDatabase,
    onRenameDatabase,
    onDropDatabase,
    onDropTable,
    onTruncateTable,
    onRenameTable,
    dialogs,
  }
}
