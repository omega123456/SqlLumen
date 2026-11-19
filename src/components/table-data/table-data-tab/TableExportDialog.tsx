import { useCallback } from 'react'
import { useTableDataStore, type TableDataTabState } from '../../../stores/table-data-store'
import { exportTableData } from '../../../lib/table-data-commands'
import ExportDialog from '../../dialogs/ExportDialog'
import type { ExportOptions, FilterCondition, TableDataTab } from '../../../types/schema'

interface TableDataExportScope {
  filterModel?: FilterCondition[]
  sortColumn?: string
  sortDirection?: string
  page?: number
  pageSize?: number
}

function tableDataExportScope(tabState: TableDataTabState | undefined): TableDataExportScope {
  if (!tabState) return {}
  const { sort, filters } = tabState.view.spec
  const hasActiveFilters = filters.length > 0
  return {
    filterModel: hasActiveFilters ? filters : undefined,
    sortColumn: sort?.column,
    sortDirection: sort?.direction,
    page: tabState.page.currentPage,
    pageSize: tabState.page.pageSize,
  }
}

function useTableExport(tab: TableDataTab) {
  const closeExportDialog = useTableDataStore((state) => state.closeExportDialog)
  const { id: tabId, connectionId, databaseName: database, objectName: table } = tab
  return useCallback(
    async (options: Required<ExportOptions>) => {
      const tabState = useTableDataStore.getState().tabs[tabId]
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
    [connectionId, database, table, closeExportDialog, tabId]
  )
}

interface TableExportDialogProps {
  tab: TableDataTab
  isOpen: boolean
}

export function TableExportDialog({ tab, isOpen }: TableExportDialogProps) {
  const closeExportDialog = useTableDataStore((state) => state.closeExportDialog)
  const handleExport = useTableExport(tab)
  if (!isOpen) return null
  return (
    <ExportDialog
      connectionId={tab.connectionId}
      tabId={tab.id}
      onClose={() => closeExportDialog(tab.id)}
      onExport={handleExport}
      defaultTableName={tab.objectName}
      isView={tab.objectType === 'view'}
    />
  )
}
