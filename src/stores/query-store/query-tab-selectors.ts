import { hasUnsavedModifications } from '../data-view/data-view-selectors'
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

export function hasAnyUnsavedEdits(tab: TabQueryState | undefined): boolean {
  if (!tab) return false
  return tab.results.some((result) => hasUnsavedModifications(result.view))
}

export function getFlatTabState(tab: TabQueryState | undefined): FlatTabView {
  const result = getActiveResult(tab)
  return {
    ...(tab ?? { ...DEFAULT_TAB_STATE }),
    ...result,
  }
}

export function isExecutionLocked(tab: TabQueryState | undefined): boolean {
  return tab !== undefined && isEditorLockStatus(tab.tabStatus)
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
