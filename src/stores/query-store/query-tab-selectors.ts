import { RESULT_PAGE_SIZE, type ViewRange } from '../../lib/result-window-cache'
import { getFirstSqlKeyword } from '../../lib/sql-utils'
import { useWorkspaceStore } from '../workspace-store'
import { isEditorLockStatus } from '../../lib/query-tab-status'
import { hasResults } from './result-lists'
import { DEFAULT_RESULT_STATE, DEFAULT_TAB_STATE } from './query-state-defaults'
import type { FlatTabView, SingleResultState, TabQueryState } from './query-state-types'

export function isEditableSelectSql(sql: string | null): boolean {
  if (!sql) return false
  const firstToken = getFirstSqlKeyword(sql)
  return firstToken === 'SELECT' || firstToken === 'WITH'
}

export function isCallSql(sql: string): boolean {
  return getFirstSqlKeyword(sql) === 'CALL'
}

export function isQueryTabVisibleInWorkspace(tabId: string): boolean {
  const workspaceState = useWorkspaceStore.getState()

  for (const [connectionId, tabs] of Object.entries(workspaceState.tabsByConnection)) {
    if (!tabs.some((tab) => tab.id === tabId)) {
      continue
    }

    if (workspaceState.visibleConnectionSessionId !== connectionId) {
      return false
    }

    return workspaceState.activeTabByConnection[connectionId] === tabId
  }

  return false
}

export function isTableDataInBottomPanel(
  tab: TabQueryState | undefined,
  tableTabId: string
): boolean {
  const bottomPanelItem = tab?.activeBottomPanelItem
  if (bottomPanelItem?.type !== 'table-data') return false
  return bottomPanelItem.tabId === tableTabId
}

export function activeResultIndexOf(tab: TabQueryState | undefined): number {
  if (!hasResults(tab)) return 0
  return Math.min(tab.activeResultIndex, tab.results.length - 1)
}

export function getActiveResult(tab: TabQueryState | undefined): SingleResultState {
  return tab?.results[activeResultIndexOf(tab)] ?? DEFAULT_RESULT_STATE
}

export function hasUnsavedModifications(result: SingleResultState | undefined): boolean {
  const modifiedColumnCount = result?.view.edit.state?.modifiedColumns.size ?? 0
  return modifiedColumnCount > 0
}

export function hasAnyUnsavedEdits(tab: TabQueryState | undefined): boolean {
  if (!tab) return false
  return tab.results.some(hasUnsavedModifications)
}

export function getFlatTabState(tab: TabQueryState | undefined): FlatTabView {
  const result = getActiveResult(tab)
  return {
    ...(tab ?? { ...DEFAULT_TAB_STATE }),
    ...result,
  }
}

export function countRanges(ranges: readonly ViewRange[]): number {
  return ranges.reduce((sum, [start, end]) => sum + Math.max(0, end - start), 0)
}

export function isSelectedRowInView(result: SingleResultState): boolean {
  const selectedRowIndex = result.view.selection.rowIndex
  if (selectedRowIndex === null) return false
  const isAtOrAfterFirstRow = selectedRowIndex >= 0
  const isBeforeLastRow = selectedRowIndex < result.view.slot.viewRowCount
  return isAtOrAfterFirstRow && isBeforeLastRow
}

function firstCheckedRowIndex(checkedRanges: readonly ViewRange[]): number | null {
  const firstCheckedRange = checkedRanges.find(([start, end]) => end > start)
  return firstCheckedRange ? firstCheckedRange[0] : null
}

export function cloneSourceRowIndex(result: SingleResultState): number | null {
  const checkedCount = countRanges(result.view.checked.ranges)
  if (checkedCount === 1) return firstCheckedRowIndex(result.view.checked.ranges)
  if (checkedCount > 1) return null
  if (!isSelectedRowInView(result)) return null
  return result.view.selection.rowIndex
}

export function isExecutionLocked(tab: TabQueryState | undefined): boolean {
  return tab !== undefined && isEditorLockStatus(tab.tabStatus)
}

export function residentRowResidency(
  previous: SingleResultState | undefined
): SingleResultState['view']['residency']['rows'] {
  const residency = previous?.view.residency.rows ?? DEFAULT_RESULT_STATE.view.residency.rows
  return {
    ...residency,
    status: 'resident',
    inactiveSince: residency.isActive ? null : residency.inactiveSince,
  }
}

export function isRestorableEvictedResult(
  result: SingleResultState | undefined
): result is SingleResultState {
  return (
    result !== undefined &&
    result.view.residency.rows.status === 'evicted' &&
    !result.view.residency.isExpired
  )
}

export function needsDeferredAnalysis(
  result: SingleResultState | undefined
): result is SingleResultState {
  return (
    result !== undefined &&
    !result.isAnalyzed &&
    result.reExecutable &&
    Boolean(result.lastExecutedSql)
  )
}

export function restoreWindowStart(result: SingleResultState): number {
  const anchorRow = Math.min(
    result.view.layout.scrollRow,
    Math.max(0, result.view.slot.viewRowCount - 1)
  )
  return Math.floor(anchorRow / RESULT_PAGE_SIZE) * RESULT_PAGE_SIZE
}
