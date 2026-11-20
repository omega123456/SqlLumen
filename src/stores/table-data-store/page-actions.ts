import type { FrontendRowResidencyState, TablePageResult } from '../../types/schema'
import { fetchTablePage, type FetchTableDataParams } from '../../lib/table-data-commands'
import { getTableForeignKeys } from '../../lib/schema-commands'
import { cancelQuery as cancelQueryCmd, evictResults } from '../../lib/query-commands'
import { dropTabResultWindows, seedResultWindow } from '../../lib/result-window-cache'
import { mapSingleColumnForeignKeys } from '../../lib/foreign-key-utils'
import { hasPendingRowChanges } from '../../lib/row-edit-state'
import { logFrontend } from '../../lib/app-log-commands'
import { describeQueryFailure, toErrorMessage } from '../../lib/error-message'
import { showErrorToast, showSuccessToast } from '../toast-store'
import { DEFAULT_EDIT_SESSION } from '../data-view/data-view-defaults'
import type { DataViewPatch, PageEdgeSelection, PageRequest } from '../data-view/data-view-types'
import { dropRowActionCancels } from '../data-view/row-action-progress'
import { putTableDataTab, removeTableDataTab } from './table-data-reducers'
import {
  cancelTableDataLifecycleTimer,
  isTableTabOpen,
  patchTableTab,
  tableTabOf,
} from './table-data-access'
import { tableEditTargetOf } from './table-data-edit-target'
import {
  FIRST_TABLE_PAGE,
  TABLE_PAGE_RESULT_INDEX,
  createDefaultTabState,
  isTableDataTabVisibleInWorkspace,
  tableSurfaceRef,
  type TableDataMeta,
  type TableDataSource,
  type TableDataTabState,
} from './table-data-tab-state'
import { useTableDataStore } from '../table-data-store'

const TABLE_PAGE_SUPERSEDED_TOKEN = 'table_page_superseded'

const RESET_SCROLL: DataViewPatch = { layout: { scrollRow: 0, scrollCol: 0 } }

export function initTab(tabId: string, table: TableDataSource): void {
  useTableDataStore.setState((state) =>
    putTableDataTab(state, { tabId: tabId, tab: createDefaultTabState(table) })
  )
}

function evictTablePageSlot(connectionId: string, tabId: string) {
  evictResults(connectionId, tabId).catch((error: unknown) => {
    logFrontend('warn', `Table page eviction failed for tab ${tabId}: ${toErrorMessage(error)}`)
  })
}

export function cleanupTab(tabId: string): void {
  const tab = tableTabOf(tabId)
  if (tab) {
    cancelTableDataLifecycleTimer(tabId)
    evictTablePageSlot(tab.table.connectionId, tabId)
    dropTabResultWindows(tabId)
    dropRowActionCancels(tableSurfaceRef(tabId))
  }
  useTableDataStore.setState((state) => removeTableDataTab(state, tabId))
}

function applyForeignKeys(tabId: string, foreignKeys: TableDataMeta['foreignKeys']) {
  const tab = tableTabOf(tabId)
  if (!tab) return
  const hasEditTarget = tab.view.editTarget.tableName !== null
  patchTableTab(tabId, {
    meta: { foreignKeys: foreignKeys },
    view: hasEditTarget ? { editTarget: { foreignKeys: foreignKeys } } : undefined,
  })
}

function loadForeignKeys(tabId: string, table: TableDataSource) {
  getTableForeignKeys(table.connectionId, table.database, table.table)
    .then((foreignKeyInfos) => applyForeignKeys(tabId, mapSingleColumnForeignKeys(foreignKeyInfos)))
    .catch((error: unknown) => {
      logFrontend('warn', 'FK metadata fetch failed: ' + toErrorMessage(error))
    })
}

export async function loadTableData(tabId: string): Promise<void> {
  const tab = tableTabOf(tabId)
  if (!tab) return

  patchTableTab(tabId, {
    page: { currentPage: FIRST_TABLE_PAGE, error: null },
    meta: { foreignKeys: [] },
    view: { ...RESET_SCROLL, edit: DEFAULT_EDIT_SESSION },
  })
  loadForeignKeys(tabId, tab.table)
  await fetchPage(tabId, { page: FIRST_TABLE_PAGE, select: null })
}

function pageFetchParams(tab: TableDataTabState, tabId: string, page: number) {
  const { sort, filters } = tab.view.spec
  const hasFilters = filters.length > 0
  const params: FetchTableDataParams = {
    connectionId: tab.table.connectionId,
    tabId: tabId,
    database: tab.table.database,
    table: tab.table.table,
    page: page,
    pageSize: tab.page.pageSize,
    sortColumn: sort?.column,
    sortDirection: sort?.direction,
    filterModel: hasFilters ? filters : undefined,
  }
  return params
}

function residencyAfterFetch(
  isStillVisible: boolean,
  previous: FrontendRowResidencyState
): FrontendRowResidencyState {
  if (isStillVisible) {
    return { status: 'resident', isActive: true, inactiveSince: null }
  }
  return {
    status: 'resident',
    isActive: false,
    inactiveSince: previous.inactiveSince ?? Date.now(),
  }
}

function selectedRowAfterFetch(select: PageEdgeSelection | null, viewRowCount: number) {
  if (select === null) return null
  if (viewRowCount === 0) return null
  if (select === 'first') return 0
  return viewRowCount - 1
}

function seedTablePageWindow(tab: TableDataTabState, tabId: string, result: TablePageResult) {
  seedResultWindow({
    route: 'table',
    connectionId: tab.table.connectionId,
    tabId: tabId,
    resultIndex: TABLE_PAGE_RESULT_INDEX,
    queryId: result.queryId,
    viewVersion: result.viewVersion,
    viewRowCount: result.viewRowCount,
    columns: result.columns,
    window: result.firstWindow,
  })
}

interface FetchedPage {
  tab: TableDataTabState
  result: TablePageResult
  select: PageEdgeSelection | null
  isStillVisible: boolean
}

function fetchedPageViewPatch(fetched: FetchedPage, meta: TableDataMeta): DataViewPatch {
  const { tab, result } = fetched
  return {
    slot: {
      connectionId: tab.table.connectionId,
      queryId: result.queryId,
      columns: result.columns,
      viewVersion: result.viewVersion,
      viewRowCount: result.viewRowCount,
      totalRows: result.totalRows,
    },
    selection: { rowIndex: selectedRowAfterFetch(fetched.select, result.viewRowCount), cell: null },
    checked: { ranges: [], viewVersion: result.viewVersion },
    spec: { applying: null, error: null },
    window: { pendingRange: null, failedRange: null },
    editTarget: tableEditTargetOf(tab.table, meta),
    residency: {
      rows: residencyAfterFetch(fetched.isStillVisible, tab.view.residency.rows),
      evictedAt: null,
      isExpired: false,
    },
  }
}

function applyFetchedPage(tabId: string, fetched: FetchedPage) {
  const { tab, result } = fetched
  const meta: TableDataMeta = {
    columns: result.columns,
    primaryKey: result.primaryKey,
    foreignKeys: tab.meta.foreignKeys,
  }
  patchTableTab(tabId, {
    page: {
      currentPage: result.currentPage,
      pageSize: result.pageSize,
      fetchedRowCount: result.totalRows,
      isLoading: false,
      isCancelling: false,
      executionTimeMs: result.executionTimeMs,
    },
    meta: meta,
    view: fetchedPageViewPatch(fetched, meta),
  })
}

function isSupersededPageFetch(error: unknown): boolean {
  return toErrorMessage(error).includes(TABLE_PAGE_SUPERSEDED_TOKEN)
}

function recordPageFetchFailure(tabId: string, error: unknown) {
  const tab = tableTabOf(tabId)
  if (!tab) return
  if (isSupersededPageFetch(error)) {
    logFrontend('info', `[table-data] superseded page fetch ignored: ${toErrorMessage(error)}`)
    return
  }
  patchTableTab(tabId, {
    page: {
      error: describeQueryFailure(tab.page.isCancelling, error),
      isLoading: false,
      isCancelling: false,
    },
    view: { spec: { applying: null } },
  })
}

function warnIfPendingEditIsDropped(tabId: string, tab: TableDataTabState) {
  if (!hasPendingRowChanges(tab.view.edit.state)) return
  logFrontend('warn', `[table-data] a page fetch for tab ${tabId} dropped unsaved row changes`)
}

function startPageFetch(tabId: string, tab: TableDataTabState, page: number) {
  const isDifferentPage = tab.page.currentPage !== page
  const scrollPatch = isDifferentPage ? RESET_SCROLL : {}
  warnIfPendingEditIsDropped(tabId, tab)
  patchTableTab(tabId, {
    page: { isLoading: true, isCancelling: false, error: null },
    view: { ...scrollPatch, edit: DEFAULT_EDIT_SESSION },
  })
}

export async function fetchPage(tabId: string, { page, select }: PageRequest): Promise<void> {
  const tab = tableTabOf(tabId)
  if (!tab) return

  startPageFetch(tabId, tab, page)
  let result: TablePageResult
  try {
    result = await fetchTablePage(pageFetchParams(tab, tabId, page))
  } catch (error) {
    recordPageFetchFailure(tabId, error)
    return
  }

  const latestTab = tableTabOf(tabId)
  if (!latestTab) return
  seedTablePageWindow(latestTab, tabId, result)
  const isStillVisible = isTableDataTabVisibleInWorkspace(tabId)
  applyFetchedPage(tabId, {
    tab: latestTab,
    result: result,
    select: select,
    isStillVisible: isStillVisible,
  })
  if (!isStillVisible) {
    useTableDataStore.getState().markTableDataSurfaceInactive(tabId)
  }
}

async function requestCancel(tabId: string, connectionId: string) {
  try {
    const cancelled = await cancelQueryCmd(connectionId, tabId)
    if (!isTableTabOpen(tabId)) return
    if (cancelled) {
      showSuccessToast('Query cancelled')
      return
    }
    patchTableTab(tabId, { page: { isCancelling: false } })
  } catch (error) {
    if (!isTableTabOpen(tabId)) return
    patchTableTab(tabId, { page: { isCancelling: false } })
    showErrorToast('Cancel failed', toErrorMessage(error))
  }
}

export async function cancelLoad(tabId: string): Promise<void> {
  const tab = tableTabOf(tabId)
  if (!tab) return
  if (!tab.page.isLoading) return
  if (tab.page.isCancelling) return

  patchTableTab(tabId, { page: { isCancelling: true } })
  await requestCancel(tabId, tab.table.connectionId)
}

export async function refreshData(tabId: string): Promise<void> {
  const tab = tableTabOf(tabId)
  if (!tab) return
  await fetchPage(tabId, { page: tab.page.currentPage, select: null })
}

export function refreshEditTarget(tabId: string): void {
  const tab = tableTabOf(tabId)
  if (!tab) return
  const hasLoadedPage = tab.view.slot.queryId !== null
  if (!hasLoadedPage) return
  patchTableTab(tabId, { view: { editTarget: tableEditTargetOf(tab.table, tab.meta) } })
}

export async function setPageSize(tabId: string, newPageSize: number): Promise<void> {
  patchTableTab(tabId, { page: { pageSize: newPageSize }, view: RESET_SCROLL })
  await fetchPage(tabId, { page: FIRST_TABLE_PAGE, select: null })
}

export function pageActions() {
  return {
    initTab,
    cleanupTab,
    loadTableData,
    fetchPage,
    cancelLoad,
    refreshData,
    setPageSize,
    refreshEditTarget,
  }
}
