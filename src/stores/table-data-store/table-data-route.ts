import type { ResultViewSpec } from '../../types/schema'
import type { InsertedColumnValue } from '../../lib/table-data-commands'
import { appendResultRow } from '../../lib/query-commands'
import {
  appendResultWindowRow,
  applyResultView,
  isRowCeilingReachedError,
} from '../../lib/result-window-cache'
import { projectSavedCellValue } from '../../lib/row-write-payloads'
import { hasPendingRowChanges } from '../../lib/row-edit-state'
import { logFrontend } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import { showWarningToast } from '../toast-store'
import {
  registerDataViewRoute,
  type DataViewSelector,
  type StoredBlobTable,
  type ViewPaintRequest,
  type ViewSpecRequest,
} from '../data-view/route-registry'
import type { DataViewSurfaceRef } from '../data-view/data-view-types'
import { slotRefOf } from '../data-view/data-view-selectors'
import { paintedViewPatch } from '../data-view/view-actions'
import { isTableTabOpen, patchTableTab, tableTabOf } from './table-data-access'
import { tableEditInfoOf } from './table-data-edit-target'
import { fetchPage, refreshData } from './page-actions'
import {
  FIRST_TABLE_PAGE,
  type TableDataMeta,
  type TableDataTabState,
} from './table-data-tab-state'
import { useTableDataStore } from '../table-data-store'

function useTableView<Selected>(
  ref: DataViewSurfaceRef,
  selector: DataViewSelector<Selected>
): Selected {
  return useTableDataStore((state) => selector(state.tabs[ref.tabId]?.view))
}

async function requestTableView(
  ref: DataViewSurfaceRef,
  { spec, kind }: ViewSpecRequest
): Promise<void> {
  if (!isTableTabOpen(ref.tabId)) return
  patchTableTab(ref.tabId, {
    view: {
      spec: { sort: spec.sort, filters: spec.filters, applying: kind, error: null },
      layout: { scrollRow: 0, scrollCol: 0 },
    },
  })
  await fetchPage(ref.tabId, { page: FIRST_TABLE_PAGE, select: null })
}

function latestRequestedTableSpec(ref: DataViewSurfaceRef): ResultViewSpec | null {
  const view = tableTabOf(ref.tabId)?.view
  if (!view) return null
  return { sort: view.spec.sort, filters: view.spec.filters }
}

function latestKnownTableVersion(ref: DataViewSurfaceRef): number {
  return tableTabOf(ref.tabId)?.view.slot.viewVersion ?? 0
}

function paintTableView(ref: DataViewSurfaceRef, request: ViewPaintRequest) {
  applyResultView(ref.tabId, ref.resultIndex, request.view)
  patchTableTab(ref.tabId, { view: paintedViewPatch(request) })
}

function insertedRowOf(meta: TableDataMeta, inserted: InsertedColumnValue[]): unknown[] {
  const insertedValues = Object.fromEntries(inserted)
  return meta.columns.map((column) =>
    projectSavedCellValue(insertedValues[column.name] ?? null, 'blobPlaceholders')
  )
}

async function refetchCurrentPage(tabId: string, error: unknown): Promise<boolean> {
  logFrontend(
    'info',
    `[table-data] appending the inserted row failed, reloading the page: ${toErrorMessage(error)}`
  )
  await refreshData(tabId)
  return true
}

function warnInsertedRowNotShown(): boolean {
  showWarningToast(
    'Row saved',
    "The page is at the row limit, so the new row isn't shown. Go to another page or raise the results row limit to see it."
  )
  return false
}

async function recoverFromRefusedAppend(tabId: string, error: unknown): Promise<boolean> {
  if (isRowCeilingReachedError(error)) return warnInsertedRowNotShown()
  return refetchCurrentPage(tabId, error)
}

async function appendInsertedRow(
  ref: DataViewSurfaceRef,
  inserted: InsertedColumnValue[]
): Promise<boolean> {
  const tab = tableTabOf(ref.tabId)
  if (!tab) return false
  const slot = slotRefOf(ref, tab.view)
  if (!slot) return refetchCurrentPage(ref.tabId, 'the table page has no slot')
  try {
    const appended = await appendResultRow({
      ...slot,
      baseViewVersion: tab.view.slot.viewVersion,
      row: insertedRowOf(tab.meta, inserted),
    })
    if (!isTableTabOpen(ref.tabId)) return true
    appendResultWindowRow({
      tabId: ref.tabId,
      resultIndex: ref.resultIndex,
      viewVersion: appended.viewVersion,
      viewRowCount: appended.viewRowCount,
      window: appended.window,
    })
    patchTableTab(ref.tabId, {
      view: {
        slot: {
          viewVersion: appended.viewVersion,
          viewRowCount: appended.viewRowCount,
          totalRows: appended.totalRows,
        },
        selection: { rowIndex: appended.window.offset },
        checked: { ranges: [], viewVersion: appended.viewVersion },
      },
    })
    return true
  } catch (error) {
    return recoverFromRefusedAppend(ref.tabId, error)
  }
}

function canRefetchExpiredPage(tab: TableDataTabState): boolean {
  if (!tab.view.residency.isExpired) return false
  if (tab.page.isLoading) return false
  return !hasPendingRowChanges(tab.view.edit.state)
}

async function refetchExpiredPage(tabId: string, tab: TableDataTabState) {
  patchTableTab(tabId, {
    view: {
      residency: { isExpired: false, rows: { ...tab.view.residency.rows, status: 'restoring' } },
    },
  })
  await fetchPage(tabId, { page: tab.page.currentPage, select: null })
  const latestTab = tableTabOf(tabId)
  const isStillRestoring = latestTab?.view.residency.rows.status === 'restoring'
  if (!isStillRestoring) return
  patchTableTab(tabId, {
    view: { residency: { rows: { ...latestTab.view.residency.rows, status: 'evicted' } } },
  })
}

function refetchExpiredPageWhenSettled(tabId: string) {
  const tab = tableTabOf(tabId)
  if (!tab) return
  if (!canRefetchExpiredPage(tab)) return
  void refetchExpiredPage(tabId, tab)
}

function expireTablePage(ref: DataViewSurfaceRef) {
  if (!isTableTabOpen(ref.tabId)) return
  patchTableTab(ref.tabId, { view: { residency: { isExpired: true } } })
  refetchExpiredPageWhenSettled(ref.tabId)
}

function tablePageBlobTable(ref: DataViewSurfaceRef): StoredBlobTable | null {
  const tab = tableTabOf(ref.tabId)
  if (!tab?.meta.primaryKey) return null
  const columns = tab.meta.columns
  return {
    connectionId: tab.table.connectionId,
    tableInfo: tableEditInfoOf(tab.table, tab.meta),
    boundNameOf: (columnIndex) => columns[columnIndex]?.name,
    columnIndexOf: (columnName) => {
      const columnIndex = columns.findIndex((column) => column.name === columnName)
      return columnIndex < 0 ? undefined : columnIndex
    },
  }
}

export function registerTableDataRoute() {
  registerDataViewRoute({
    kind: 'table',
    binding: {
      read: (ref) => tableTabOf(ref.tabId)?.view,
      update: (ref, patch) => patchTableTab(ref.tabId, { view: patch }),
      useView: useTableView,
    },
    viewRequests: {
      apply: requestTableView,
      retry: (ref) => void refreshData(ref.tabId),
      latestRequested: latestRequestedTableSpec,
      latestKnownVersion: latestKnownTableVersion,
      paint: paintTableView,
    },
    writes: {
      cellProjection: 'blobPlaceholders',
      afterInsert: appendInsertedRow,
      staleResultAdvice: 'Reload the table to refresh.',
    },
    lifecycle: {
      onExpired: expireTablePage,
      onEditClosed: (ref) => refetchExpiredPageWhenSettled(ref.tabId),
      isReplacingSlot: (ref) => tableTabOf(ref.tabId)?.page.isLoading ?? false,
    },
    blobs: {
      storedTable: tablePageBlobTable,
    },
  })
}
