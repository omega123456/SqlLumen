import { useCallback, useState } from 'react'
import { dispatchDismissAll } from '../../../lib/context-menu-events'
import type { CopyObjectSelection } from '../../../lib/copy-to-host-commands'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import {
  CLOSED_COPY_TO_HOST_DIALOG,
  CLOSED_DUMP_DIALOG,
  CLOSED_MENU,
  type ContextMenuState,
  type CopyToHostDialogState,
  type SqlDumpDialogState,
} from './object-browser-model'

const NEW_TABLE_OBJECT_NAME = '__new_table__'

function useTableDesignerLaunchers(connectionId: string) {
  const openTab = useWorkspaceStore((state) => state.openTab)

  const handleDesignTable = useCallback(
    (databaseName: string, tableName: string) => {
      openTab({
        type: 'table-designer',
        mode: 'alter',
        objectName: tableName,
        databaseName: databaseName,
        connectionId: connectionId,
        label: tableName,
      })
    },
    [connectionId, openTab]
  )

  const handleCreateTable = useCallback(
    (databaseName: string) => {
      openTab({
        type: 'table-designer',
        mode: 'create',
        objectName: NEW_TABLE_OBJECT_NAME,
        databaseName: databaseName,
        connectionId: connectionId,
        label: 'New table',
      })
    },
    [connectionId, openTab]
  )

  return { handleDesignTable, handleCreateTable }
}

function useExportDialogs() {
  const [dumpDialog, setDumpDialog] = useState<SqlDumpDialogState>(CLOSED_DUMP_DIALOG)
  const [copyToHostDialog, setCopyToHostDialog] = useState<CopyToHostDialogState>(
    CLOSED_COPY_TO_HOST_DIALOG
  )

  const handleExportDump = useCallback((databaseName: string, tableName?: string) => {
    setDumpDialog({ open: true, database: databaseName, table: tableName, schemaOnly: false })
  }, [])

  const handleExportDdl = useCallback((databaseName: string, tableName?: string) => {
    setDumpDialog({ open: true, database: databaseName, table: tableName, schemaOnly: true })
  }, [])

  const handleCopyToHost = useCallback(
    (databaseName: string, objectSelection?: CopyObjectSelection) => {
      setCopyToHostDialog({ open: true, database: databaseName, objectSelection: objectSelection })
    },
    []
  )

  const handleCloseDumpDialog = useCallback(() => setDumpDialog(CLOSED_DUMP_DIALOG), [])
  const handleCloseCopyToHostDialog = useCallback(
    () => setCopyToHostDialog(CLOSED_COPY_TO_HOST_DIALOG),
    []
  )

  return {
    dumpDialog,
    copyToHostDialog,
    handleExportDump,
    handleExportDdl,
    handleCopyToHost,
    handleCloseDumpDialog,
    handleCloseCopyToHostDialog,
  }
}

export function useObjectBrowserMenus(connectionId: string) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(CLOSED_MENU)

  const handleContextMenu = useCallback((event: React.MouseEvent, nodeId: string) => {
    event.preventDefault()
    dispatchDismissAll()
    requestAnimationFrame(() => {
      setContextMenu({ visible: true, x: event.clientX, y: event.clientY, nodeId: nodeId })
    })
  }, [])

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(CLOSED_MENU)
  }, [])

  const tableDesignerLaunchers = useTableDesignerLaunchers(connectionId)
  const exportDialogs = useExportDialogs()

  return {
    contextMenu,
    handleContextMenu,
    handleContextMenuClose,
    ...tableDesignerLaunchers,
    ...exportDialogs,
  }
}

export type ObjectBrowserMenus = ReturnType<typeof useObjectBrowserMenus>
