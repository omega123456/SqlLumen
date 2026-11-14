import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { type TableTarget } from '../../components/object-browser/ObjectBrowserActionDialogs'
import { TableDialogs } from '../../components/object-browser/TableActionDialogs'
import { useTargetedOperation } from './use-targeted-operation'

export interface TableActions {
  onDropTable: (db: string, table: string) => void
  onTruncateTable: (db: string, table: string) => void
  onRenameTable: (db: string, table: string) => void
  dialogs: ReactNode
}

export function useTableActions(connectionId: string): TableActions {
  const dropOperation = useTargetedOperation<TableTarget>()
  const truncateOperation = useTargetedOperation<TableTarget>()
  const renameOperation = useTargetedOperation<TableTarget>()
  const { open: openDrop } = dropOperation
  const { open: openTruncate } = truncateOperation
  const { open: openRename } = renameOperation

  return {
    onDropTable: useCallback((db: string, table: string) => openDrop({ db, table }), [openDrop]),
    onTruncateTable: useCallback(
      (db: string, table: string) => openTruncate({ db, table }),
      [openTruncate]
    ),
    onRenameTable: useCallback(
      (db: string, table: string) => openRename({ db, table }),
      [openRename]
    ),
    dialogs: (
      <TableDialogs
        connectionId={connectionId}
        dropOperation={dropOperation}
        truncateOperation={truncateOperation}
        renameOperation={renameOperation}
      />
    ),
  }
}
