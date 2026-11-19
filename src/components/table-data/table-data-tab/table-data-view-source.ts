import { useMemo } from 'react'
import {
  hasNextTablePage,
  tableSurfaceRef,
  useTableDataStore,
} from '../../../stores/table-data-store'
import type { TableDataTabState } from '../../../stores/table-data-store'
import type { ViewMode } from '../../../types/schema'
import type {
  DataViewColumnJump,
  DataViewPaging,
  DataViewReload,
  DataViewSource,
  DataViewTestIds,
} from '../../shared/data-view/data-view-source'

const TABLE_DATA_MODES: readonly ViewMode[] = ['grid', 'form', 'text']

const TABLE_DATA_TEST_IDS: DataViewTestIds = {
  grid: 'table-data-grid',
  form: 'table-data-form-view',
  text: 'table-data-text-view',
  toolbar: 'table-data-toolbar',
  restoreOverlay: 'table-data-restore-overlay',
  busyOverlay: 'table-data-sort-overlay',
}

const NO_PRIMARY_KEY_BLOB_REASON = 'Cannot view BLOB — table has no primary key'

function hasEditTarget(tab: TableDataTabState | undefined): boolean {
  if (!tab) return false
  return tab.view.editTarget.tableName !== null
}

function useTablePaging(tabId: string, page: TableDataTabState['page'] | undefined) {
  const fetchPage = useTableDataStore((state) => state.fetchPage)
  const setPageSize = useTableDataStore((state) => state.setPageSize)
  const currentPage = page?.currentPage ?? 1
  const pageSize = page?.pageSize ?? 0
  const hasNextPage = page ? hasNextTablePage(page) : false
  return useMemo<DataViewPaging>(
    () => ({
      currentPage: currentPage,
      pageSize: pageSize,
      hasNextPage: hasNextPage,
      goToPage: (request) => void fetchPage(tabId, request),
      setPageSize: (nextPageSize) => void setPageSize(tabId, nextPageSize),
    }),
    [currentPage, pageSize, hasNextPage, fetchPage, setPageSize, tabId]
  )
}

function useTableReload(tabId: string, page: TableDataTabState['page'] | undefined) {
  const refreshData = useTableDataStore((state) => state.refreshData)
  const cancelLoad = useTableDataStore((state) => state.cancelLoad)
  const isLoading = page?.isLoading ?? false
  const isCancelling = page?.isCancelling ?? false
  return useMemo<DataViewReload>(
    () => ({
      isLoading: isLoading,
      isCancelling: isCancelling,
      onReload: () => void refreshData(tabId),
      onCancel: () => void cancelLoad(tabId),
    }),
    [isLoading, isCancelling, refreshData, cancelLoad, tabId]
  )
}

function useTableColumnJump(tabId: string) {
  const target = useTableDataStore((state) => state.columnJumpRequests[tabId] ?? null)
  const highlightedColumn = useTableDataStore(
    (state) => state.highlightedColumnByTab[tabId] ?? null
  )
  const consumeColumnJump = useTableDataStore((state) => state.consumeColumnJump)
  const clearColumnHighlight = useTableDataStore((state) => state.clearColumnHighlight)
  return useMemo<DataViewColumnJump>(
    () => ({
      target: target,
      highlightedColumn: highlightedColumn,
      consume: () => consumeColumnJump(tabId),
      clearHighlight: () => clearColumnHighlight(tabId),
    }),
    [target, highlightedColumn, consumeColumnJump, clearColumnHighlight, tabId]
  )
}

export interface TableDataViewSourceInputs {
  tabId: string
  isActive: boolean
  isView: boolean
}

export function useTableDataViewSource({
  tabId,
  isActive,
  isView,
}: TableDataViewSourceInputs): DataViewSource {
  const page = useTableDataStore((state) => state.tabs[tabId]?.page)
  const hasPrimaryKey = useTableDataStore((state) => Boolean(state.tabs[tabId]?.meta.primaryKey))
  const canEdit = useTableDataStore((state) => hasEditTarget(state.tabs[tabId]))
  const ref = useMemo(() => tableSurfaceRef(tabId), [tabId])
  const paging = useTablePaging(tabId, page)
  const reload = useTableReload(tabId, page)
  const columnJump = useTableColumnJump(tabId)
  return useMemo<DataViewSource>(
    () => ({
      ref: ref,
      testIds: TABLE_DATA_TEST_IDS,
      isActive: isActive,
      isTruncated: false,
      capabilities: {
        modes: TABLE_DATA_MODES,
        canEdit: canEdit,
        rowActions: !isView,
        blobViewDisabledReason: hasPrimaryKey ? null : NO_PRIMARY_KEY_BLOB_REASON,
        paging: paging,
        reload: reload,
        columnJump: columnJump,
      },
    }),
    [ref, isActive, canEdit, isView, hasPrimaryKey, paging, reload, columnJump]
  )
}
