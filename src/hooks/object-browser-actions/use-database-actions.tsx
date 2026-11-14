import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { type DatabaseTarget } from '../../components/object-browser/ObjectBrowserActionDialogs'
import { DatabaseDialogs } from '../../components/object-browser/DatabaseActionDialogs'
import { useSchemaStore } from '../../stores/schema-store'
import { showSuccessToast } from '../../stores/toast-store'
import { useTargetedOperation } from './use-targeted-operation'

export interface DatabaseActions {
  createDbOpen: boolean
  alterDbOpen: boolean
  renameDbOpen: boolean
  onCreateDatabase: () => void
  onAlterDatabase: (db: string) => void
  onRenameDatabase: (db: string) => void
  onDropDatabase: (db: string) => void
  dialogs: ReactNode
}

export function useDatabaseActions(connectionId: string): DatabaseActions {
  const [createDbOpen, setCreateDbOpen] = useState(false)
  const [alterDbTarget, setAlterDbTarget] = useState<string | null>(null)
  const renameOperation = useTargetedOperation<string>()
  const dropOperation = useTargetedOperation<DatabaseTarget>()
  const { open: openRename } = renameOperation
  const { open: openDrop } = dropOperation

  const handleCreateSuccess = useCallback(
    (name: string) => {
      showSuccessToast('Database created', name)
      setCreateDbOpen(false)
      void useSchemaStore.getState().refreshAll(connectionId)
    },
    [connectionId]
  )

  const handleAlterSuccess = useCallback(() => {
    setAlterDbTarget(null)
    if (!alterDbTarget) return
    showSuccessToast('Database updated', alterDbTarget)
    void useSchemaStore.getState().refreshDatabase(connectionId, alterDbTarget)
  }, [connectionId, alterDbTarget])

  return {
    createDbOpen: createDbOpen,
    alterDbOpen: alterDbTarget !== null,
    renameDbOpen: renameOperation.target !== null,
    onCreateDatabase: useCallback(() => setCreateDbOpen(true), []),
    onAlterDatabase: useCallback((db: string) => setAlterDbTarget(db), []),
    onRenameDatabase: openRename,
    onDropDatabase: useCallback((db: string) => openDrop({ name: db }), [openDrop]),
    dialogs: (
      <DatabaseDialogs
        connectionId={connectionId}
        isCreateOpen={createDbOpen}
        alterTarget={alterDbTarget}
        renameOperation={renameOperation}
        dropOperation={dropOperation}
        onCreateClose={() => setCreateDbOpen(false)}
        onCreateSuccess={handleCreateSuccess}
        onAlterClose={() => setAlterDbTarget(null)}
        onAlterSuccess={handleAlterSuccess}
      />
    ),
  }
}
