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
import { dropObject, getRoutineParameters } from '../lib/object-editor-commands'
import { buildExecuteTemplate } from '../lib/execute-template-builder'
import { ConfirmDialog } from '../components/dialogs/ConfirmDialog'
import { CreateDatabaseDialog } from '../components/dialogs/CreateDatabaseDialog'
import { AlterDatabaseDialog } from '../components/dialogs/AlterDatabaseDialog'
import { RenameDialog } from '../components/dialogs/RenameDialog'
import { showErrorToast, showSuccessToast, showWarningToast } from '../stores/toast-store'
import { useQueryStore } from '../stores/query-store'
import type { EditableObjectType } from '../types/schema'

const RENAME_DB_WARNING =
  'This operation will create a new database, move all tables, and drop the original. Only works for databases containing tables only (no views, procedures, functions, triggers, or events).'

const OBJECT_TYPE_LABELS: Record<EditableObjectType, string> = {
  view: 'View',
  procedure: 'Procedure',
  function: 'Function',
  trigger: 'Trigger',
  event: 'Event',
}

const PLACEHOLDER_NAMES: Record<EditableObjectType, string> = {
  procedure: 'new_procedure',
  function: 'new_function',
  trigger: 'new_trigger',
  event: 'new_event',
  view: 'new_view',
}

const CREATE_LABELS: Record<EditableObjectType, string> = {
  procedure: 'New Procedure',
  function: 'New Function',
  trigger: 'New Trigger',
  event: 'New Event',
  view: 'New View',
}

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

  // Object editor callbacks (Phase 8.4)
  onAlterObject: (databaseName: string, objectName: string, objectType: EditableObjectType) => void
  onCreateObject: (databaseName: string, objectType: EditableObjectType) => void
  onDropObject: (databaseName: string, objectName: string, objectType: EditableObjectType) => void

  // Execute routine callback (Phase 8.5)
  onExecuteRoutine: (
    databaseName: string,
    routineName: string,
    routineType: 'procedure' | 'function'
  ) => void

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
  const openTab = useWorkspaceStore((state) => state.openTab)

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
  const [dropObjectConfirm, setDropObjectConfirm] = useState<{
    databaseName: string
    objectName: string
    objectType: EditableObjectType
  } | null>(null)

  // Shared loading/error state for confirm dialogs
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  // Shared loading/error state for rename dialogs
  const [renameLoading, setRenameLoading] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  const isCreateDbOpen = createDbOpen
  const isAlterDbOpen = alterDbOpen && alterDbTarget !== null
  const isRenameDbOpen = renameDbOpen && renameDbTarget !== null
  const isDropDbOpen = dropDbConfirm !== null
  const isDropTableOpen = dropTableConfirm !== null
  const isTruncateTableOpen = truncateTableConfirm !== null
  const isRenameTableOpen = renameTableOpen !== null

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

  // Object editor action callbacks (Phase 8.4)

  const onAlterObject = useCallback(
    (databaseName: string, objectName: string, objectType: EditableObjectType) => {
      openTab({
        type: 'object-editor',
        label: `${OBJECT_TYPE_LABELS[objectType]}: ${objectName}`,
        connectionId,
        databaseName,
        objectName,
        objectType,
        mode: 'alter',
      })
    },
    [connectionId, openTab]
  )

  const onCreateObject = useCallback(
    (databaseName: string, objectType: EditableObjectType) => {
      const placeholderName = PLACEHOLDER_NAMES[objectType]
      openTab({
        type: 'object-editor',
        label: CREATE_LABELS[objectType],
        connectionId,
        databaseName,
        objectName: placeholderName,
        objectType,
        mode: 'create',
      })
    },
    [connectionId, openTab]
  )

  const onDropObject = useCallback(
    (databaseName: string, objectName: string, objectType: EditableObjectType) => {
      setDropObjectConfirm({ databaseName, objectName, objectType })
      setConfirmError(null)
      setConfirmLoading(false)
    },
    []
  )

  // Execute routine handler (Phase 8.5)

  const openQueryTab = useWorkspaceStore((state) => state.openQueryTab)

  const onExecuteRoutine = useCallback(
    async (databaseName: string, routineName: string, routineType: 'procedure' | 'function') => {
      try {
        const parameters = await getRoutineParameters(
          connectionId,
          databaseName,
          routineName,
          routineType
        )
        const template = buildExecuteTemplate(databaseName, routineName, routineType, parameters)
        const tabId = openQueryTab(connectionId, `Execute: ${routineName}`)
        useQueryStore.getState().setContent(tabId, template)
      } catch (_error) {
        // Fall back to simple template
        const keyword = routineType === 'procedure' ? 'CALL' : 'SELECT'
        const fallbackTemplate = `${keyword} \`${databaseName}\`.\`${routineName}\`( /* Add parameters here */ );`
        const tabId = openQueryTab(connectionId, `Execute: ${routineName}`)
        useQueryStore.getState().setContent(tabId, fallbackTemplate)
        showWarningToast('Could not load parameters', 'Showing basic template')
      }
    },
    [connectionId, openQueryTab]
  )

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

  const handleDropObjectConfirm = useCallback(async () => {
    if (!dropObjectConfirm) return
    setConfirmLoading(true)
    setConfirmError(null)
    try {
      const { databaseName, objectName, objectType } = dropObjectConfirm
      await dropObject(connectionId, databaseName, objectName, objectType)
      closeTabsByObject(connectionId, databaseName, objectName, objectType)
      setDropObjectConfirm(null)
      // Refresh schema tree — call both refreshCategory and refreshDatabase.
      // refreshCategory may silently no-op if the category node hasn't been expanded,
      // so always also call refreshDatabase to ensure tree awareness.
      try {
        await refreshCategory(connectionId, databaseName, objectType)
      } catch {
        // Ignore refreshCategory errors
      }
      try {
        await refreshDatabase(connectionId, databaseName)
      } catch {
        // Ignore refresh errors — the drop itself succeeded
      }
      const typeLabel = OBJECT_TYPE_LABELS[objectType]
      showSuccessToast(`${typeLabel} dropped`, `${databaseName}.${objectName}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setConfirmError(msg)
      const typeLabel = dropObjectConfirm.objectType
      showErrorToast(`Failed to drop ${typeLabel}`, msg)
    } finally {
      setConfirmLoading(false)
    }
  }, [connectionId, dropObjectConfirm, closeTabsByObject, refreshCategory, refreshDatabase])

  // ---------------------------------------------------------------------------
  // Rendered dialogs
  // ---------------------------------------------------------------------------

  const dialogs = (
    <>
      {/* Database dialogs */}
      <CreateDatabaseDialog
        isOpen={isCreateDbOpen}
        connectionId={connectionId}
        onSuccess={handleCreateDbSuccess}
        onCancel={() => setCreateDbOpen(false)}
      />

      <AlterDatabaseDialog
        isOpen={isAlterDbOpen}
        connectionId={connectionId}
        databaseName={alterDbTarget ?? ''}
        onSuccess={handleAlterDbSuccess}
        onCancel={() => {
          setAlterDbOpen(false)
          setAlterDbTarget(null)
        }}
      />

      <RenameDialog
        isOpen={isRenameDbOpen}
        title="Rename Database"
        currentName={renameDbTarget ?? ''}
        warning={RENAME_DB_WARNING}
        isLoading={renameLoading}
        error={renameError}
        onConfirm={handleRenameDb}
        onCancel={() => {
          setRenameDbOpen(false)
          setRenameDbTarget(null)
        }}
      />

      <ConfirmDialog
        isOpen={isDropDbOpen}
        title="Drop Database"
        message={
          <>
            Are you sure you want to drop database <strong>{dropDbConfirm?.name ?? ''}</strong>?
          </>
        }
        confirmLabel="Drop Database"
        isDestructive
        isLoading={confirmLoading}
        error={confirmError}
        onConfirm={handleDropDb}
        onCancel={() => setDropDbConfirm(null)}
      />

      {/* Table dialogs */}
      <ConfirmDialog
        isOpen={isDropTableOpen}
        title="Drop Table"
        message={
          <>
            Are you sure you want to drop table{' '}
            <strong>
              {dropTableConfirm?.db ?? ''}.{dropTableConfirm?.table ?? ''}
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

      <ConfirmDialog
        isOpen={isTruncateTableOpen}
        title="Truncate Table"
        message={
          <>
            Are you sure you want to truncate table{' '}
            <strong>
              {truncateTableConfirm?.db ?? ''}.{truncateTableConfirm?.table ?? ''}
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

      <RenameDialog
        isOpen={isRenameTableOpen}
        title="Rename Table"
        currentName={renameTableOpen?.table ?? ''}
        isLoading={renameLoading}
        error={renameError}
        onConfirm={handleRenameTable}
        onCancel={() => setRenameTableOpen(null)}
      />

      {/* Object drop confirmation dialog */}
      {dropObjectConfirm && (
        <ConfirmDialog
          isOpen
          title={`Drop ${OBJECT_TYPE_LABELS[dropObjectConfirm.objectType]}`}
          message={
            <>
              Are you sure you want to drop{' '}
              {OBJECT_TYPE_LABELS[dropObjectConfirm.objectType].toLowerCase()}{' '}
              <strong>&apos;{dropObjectConfirm.objectName}&apos;</strong> from database{' '}
              <strong>&apos;{dropObjectConfirm.databaseName}&apos;</strong>? This action cannot be
              undone.
            </>
          }
          confirmLabel={`Drop ${OBJECT_TYPE_LABELS[dropObjectConfirm.objectType]}`}
          isDestructive
          isLoading={confirmLoading}
          error={confirmError}
          onConfirm={handleDropObjectConfirm}
          onCancel={() => setDropObjectConfirm(null)}
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
    onAlterObject,
    onCreateObject,
    onDropObject,
    onExecuteRoutine,
    dialogs,
  }
}
