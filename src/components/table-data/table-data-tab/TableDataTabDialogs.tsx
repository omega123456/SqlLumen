import { useCallback } from 'react'
import { useTableDataStore } from '../../../stores/table-data-store'
import { exportTableData } from '../../../lib/table-data-commands'
import { UnsavedChangesDialog } from '../../shared/UnsavedChangesDialog'
import ExportDialog from '../../dialogs/ExportDialog'
import type {
  ExportOptions,
  FilterCondition,
  TableDataTab,
  TableDataTabState,
} from '../../../types/schema'

interface TableDataExportScope {
  filterModel?: FilterCondition[]
  sortColumn?: string
  sortDirection?: string
  page?: number
  pageSize?: number
}

function tableDataExportScope(tabState: TableDataTabState | undefined): TableDataExportScope {
  if (!tabState) return {}
  const hasActiveFilters = tabState.filterModel.length > 0
  return {
    filterModel: hasActiveFilters ? tabState.filterModel : undefined,
    sortColumn: tabState.sort?.column,
    sortDirection: tabState.sort?.direction,
    page: tabState.currentPage,
    pageSize: tabState.pageSize,
  }
}

function useTableExport(tab: TableDataTab, tabState: TableDataTabState | undefined) {
  const closeExportDialog = useTableDataStore((state) => state.closeExportDialog)
  const { id: tabId, connectionId, databaseName: database, objectName: table } = tab
  return useCallback(
    async (options: Required<ExportOptions>) => {
      await exportTableData({
        connectionId: connectionId,
        database: database,
        table: table,
        format: options.format,
        filePath: options.filePath,
        includeHeaders: options.includeHeaders,
        tableNameForSql: options.tableName,
        ...tableDataExportScope(tabState),
      })
      closeExportDialog(tabId)
    },
    [connectionId, database, table, tabState, closeExportDialog, tabId]
  )
}

function PendingNavigationDialog({
  tabId,
  saveError,
}: {
  tabId: string
  saveError: string | null
}) {
  const confirmNavigationSave = useTableDataStore((state) => state.confirmNavigationSave)
  const confirmNavigationDiscard = useTableDataStore((state) => state.confirmNavigationDiscard)
  const cancelNavigation = useTableDataStore((state) => state.cancelNavigation)
  const handleSaveNavigation = useCallback(async () => {
    await confirmNavigationSave(tabId)
  }, [confirmNavigationSave, tabId])
  return (
    <UnsavedChangesDialog
      tabId={tabId}
      onSave={handleSaveNavigation}
      onDiscard={() => confirmNavigationDiscard(tabId)}
      onCancel={() => cancelNavigation(tabId)}
      error={saveError}
    />
  )
}

interface TableDataTabDialogsProps {
  tab: TableDataTab
  tabState: TableDataTabState | undefined
  isViewObject: boolean
  saveError: string | null
  isExportDialogOpen: boolean
  hasPendingNavigation: boolean
}

export function TableDataTabDialogs(props: TableDataTabDialogsProps) {
  const { tab, isViewObject } = props
  const closeExportDialog = useTableDataStore((state) => state.closeExportDialog)
  const handleExport = useTableExport(tab, props.tabState)
  return (
    <>
      {props.isExportDialogOpen && (
        <ExportDialog
          connectionId={tab.connectionId}
          tabId={tab.id}
          onClose={() => closeExportDialog(tab.id)}
          onExport={handleExport}
          defaultTableName={tab.objectName}
          isView={isViewObject}
        />
      )}
      {props.hasPendingNavigation && (
        <PendingNavigationDialog tabId={tab.id} saveError={props.saveError} />
      )}
    </>
  )
}
