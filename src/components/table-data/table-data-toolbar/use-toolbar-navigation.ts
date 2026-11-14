import { useCallback, useMemo, useState } from 'react'
import { useTableDataStore } from '../../../stores/table-data-store'
import { useToastStore } from '../../../stores/toast-store'
import { buildInitialConditionsFromCell } from '../../../lib/filter-utils'
import { serializeCsv } from '../../../lib/csv-utils'
import { writeClipboardText } from '../../../lib/context-menu-utils'
import { toErrorMessage } from '../../../lib/error-message'
import type { ViewMode } from '../../../types/shared-data-view'
import type { FilterCondition } from '../../../types/schema'
import { rowIndexForKey, type ToolbarTabView } from './toolbar-model'

interface ToolbarNavigationInputs {
  tabId: string
  view: ToolbarTabView
  withNavigationGuard: (action: () => void) => void
}

export function useToolbarPaging({ tabId, view, withNavigationGuard }: ToolbarNavigationInputs) {
  const { currentPage } = view
  const fetchPage = useTableDataStore((state) => state.fetchPage)
  const setPageSize = useTableDataStore((state) => state.setPageSize)
  return {
    onPageSizeChange: useCallback(
      (newSize: number) => withNavigationGuard(() => setPageSize(tabId, newSize)),
      [withNavigationGuard, setPageSize, tabId]
    ),
    onPageSubmit: (page: number) => withNavigationGuard(() => fetchPage(tabId, page)),
    onPrevPage: useCallback(() => {
      if (currentPage <= 1) return
      withNavigationGuard(() => fetchPage(tabId, currentPage - 1))
    }, [currentPage, withNavigationGuard, fetchPage, tabId]),
    onNextPage: useCallback(
      () => withNavigationGuard(() => fetchPage(tabId, currentPage + 1)),
      [currentPage, withNavigationGuard, fetchPage, tabId]
    ),
  }
}

export function useToolbarViewActions({ tabId, withNavigationGuard }: ToolbarNavigationInputs) {
  const refreshData = useTableDataStore((state) => state.refreshData)
  const cancelLoad = useTableDataStore((state) => state.cancelLoad)
  const setViewMode = useTableDataStore((state) => state.setViewMode)
  const openExportDialog = useTableDataStore((state) => state.openExportDialog)
  return {
    handleRefresh: useCallback(
      () => withNavigationGuard(() => refreshData(tabId)),
      [withNavigationGuard, refreshData, tabId]
    ),
    handleCancelLoad: useCallback(() => cancelLoad(tabId), [cancelLoad, tabId]),
    handleViewMode: useCallback(
      (mode: ViewMode) => withNavigationGuard(() => setViewMode(tabId, mode as 'grid' | 'form')),
      [withNavigationGuard, setViewMode, tabId]
    ),
    handleExport: useCallback(() => openExportDialog(tabId), [openExportDialog, tabId]),
  }
}

export function useToolbarFilter({ tabId, view, withNavigationGuard }: ToolbarNavigationInputs) {
  const { filterModel, selectedCell } = view
  const applyFilters = useTableDataStore((state) => state.applyFilters)
  const showSuccess = useToastStore((state) => state.showSuccess)
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
  const initialConditions: FilterCondition[] = useMemo(
    () => buildInitialConditionsFromCell(selectedCell, filterModel),
    [filterModel, selectedCell]
  )
  const handleFilterApply = useCallback(
    (conditions: FilterCondition[]) =>
      withNavigationGuard(() => {
        setIsFilterDialogOpen(false)
        applyFilters(tabId, conditions)
      }),
    [withNavigationGuard, applyFilters, tabId]
  )
  const handleClearFilter = useCallback(
    () =>
      withNavigationGuard(() => {
        applyFilters(tabId, [])
        showSuccess('Filters cleared')
      }),
    [withNavigationGuard, applyFilters, tabId, showSuccess]
  )
  return {
    isFilterDialogOpen: isFilterDialogOpen,
    initialConditions: initialConditions,
    openFilterDialog: () => setIsFilterDialogOpen(true),
    closeFilterDialog: () => setIsFilterDialogOpen(false),
    handleFilterApply: handleFilterApply,
    handleClearFilter: handleClearFilter,
  }
}

export function useCopyCheckedRows(view: ToolbarTabView) {
  const { checkedRowKeys, columns, rows } = view
  const editTempId = view.editState?.tempId
  const showError = useToastStore((state) => state.showError)
  const showSuccess = useToastStore((state) => state.showSuccess)
  return useCallback(async () => {
    const lookup = { rows: rows, columns: columns, editTempId: editTempId }
    const selectedRowIndices = new Set(
      checkedRowKeys.map((rowKey) => rowIndexForKey(rowKey, lookup))
    )
    const selectedRows = rows.filter((_, index) => selectedRowIndices.has(index))
    try {
      await writeClipboardText(
        serializeCsv(
          columns.map((column) => column.name),
          selectedRows
        )
      )
      showSuccess('Selected rows copied', `${selectedRows.length} row(s) copied to clipboard.`)
    } catch (error) {
      showError('Copy failed', toErrorMessage(error))
    }
  }, [checkedRowKeys, columns, editTempId, rows, showError, showSuccess])
}
