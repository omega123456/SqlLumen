import type { ReactNode } from 'react'
import type { EditableObjectType } from '../types/schema'
import { useDatabaseActions } from './object-browser-actions/use-database-actions'
import { useTableActions } from './object-browser-actions/use-table-actions'
import { useObjectActions } from './object-browser-actions/use-object-actions'

export interface UseObjectBrowserActionsReturn {
  createDbOpen: boolean
  alterDbOpen: boolean
  renameDbOpen: boolean
  onCreateDatabase: () => void
  onAlterDatabase: (db: string) => void
  onRenameDatabase: (db: string) => void
  onDropDatabase: (db: string) => void
  onDropTable: (db: string, table: string) => void
  onTruncateTable: (db: string, table: string) => void
  onRenameTable: (db: string, table: string) => void
  onAlterObject: (databaseName: string, objectName: string, objectType: EditableObjectType) => void
  onCreateObject: (databaseName: string, objectType: EditableObjectType) => void
  onDropObject: (databaseName: string, objectName: string, objectType: EditableObjectType) => void
  onExecuteRoutine: (
    databaseName: string,
    routineName: string,
    routineType: 'procedure' | 'function'
  ) => void
  dialogs: ReactNode
}

export function useObjectBrowserActions(connectionId: string): UseObjectBrowserActionsReturn {
  const databaseActions = useDatabaseActions(connectionId)
  const tableActions = useTableActions(connectionId)
  const objectActions = useObjectActions(connectionId)

  return {
    ...databaseActions,
    ...tableActions,
    ...objectActions,
    dialogs: (
      <>
        {databaseActions.dialogs}
        {tableActions.dialogs}
        {objectActions.dialogs}
      </>
    ),
  }
}
