import { evictResults as evictResultsCmd } from '../../lib/query-commands'
import { dropTabResultWindows } from '../../lib/result-window-cache'
import { logFrontendError } from '../../lib/app-log-commands'
import { isAiLockStatus } from '../../lib/query-tab-status'
import { removeQueryTabs } from './query-tab-reducers'
import { cancelExportJobInBackground, dropExportJob, runningExportJobId } from './full-export'
import { stopRunProgressPolling } from './run-and-copy'
import { DEFAULT_TAB_STATE } from './query-state-defaults'
import type { ExecutionStatus, TabStatus } from './query-state-types'
import {
  cancelAllResultLifecycleTimers,
  patchTab,
  getQueryState,
  setQueryState,
} from './query-store-access'
import { dropViewTrackers } from './result-view-requests'
import { dropRowActionCancels } from './row-action-progress'

export function getTabState(tabId: string) {
  return getQueryState().tabs[tabId] ?? { ...DEFAULT_TAB_STATE }
}

export function setContent(tabId: string, content: string) {
  patchTab(tabId, { content })
}

export function setSelectedText(tabId: string, selectedText: string) {
  const isSelectionUnchanged = getQueryState().tabs[tabId]?.selectedText === selectedText
  if (isSelectionUnchanged) return
  patchTab(tabId, { selectedText })
}

export function setFilePath(tabId: string, filePath: string | null) {
  patchTab(tabId, { filePath })
}

export function setCursorPosition(tabId: string, position: { lineNumber: number; column: number }) {
  patchTab(tabId, { cursorPosition: position })
}

export function cleanupTab(connectionId: string, tabId: string) {
  const runningJobId = runningExportJobId(tabId)
  if (runningJobId !== null) {
    cancelExportJobInBackground(runningJobId, 'cleanupTab')
  }
  dropExportJob(tabId)
  stopRunProgressPolling(tabId)
  cancelAllResultLifecycleTimers(tabId, getQueryState().tabs[tabId]?.results.length ?? 0)
  dropTabResultWindows(tabId)
  dropViewTrackers(tabId)
  dropRowActionCancels(tabId)
  evictResultsCmd(connectionId, tabId).catch((error) => {
    logFrontendError('[query-store] evictResults failed (cleanupTab):', error)
  })
  setQueryState((state) => removeQueryTabs(state, [tabId]))
}

export function cleanupConnection(connectionId: string, tabIds: string[]) {
  for (const id of tabIds) {
    dropExportJob(id)
    stopRunProgressPolling(id)
    cancelAllResultLifecycleTimers(id, getQueryState().tabs[id]?.results.length ?? 0)
    dropTabResultWindows(id)
    dropViewTrackers(id)
    dropRowActionCancels(id)
    evictResultsCmd(connectionId, id).catch((error) => {
      logFrontendError('[query-store] evictResults failed (cleanupConnection):', error)
    })
  }
  setQueryState((state) => removeQueryTabs(state, tabIds))
}

export function setTabStatus(tabId: string, newStatus: TabStatus) {
  const tab = getQueryState().tabs[tabId]
  if (!tab) return

  const isEnteringAiLock = isAiLockStatus(newStatus) && !isAiLockStatus(tab.tabStatus)
  if (!isEnteringAiLock) {
    patchTab(tabId, { tabStatus: newStatus })
    return
  }
  patchTab(tabId, {
    tabStatus: newStatus,
    prevTabStatus: tab.tabStatus as ExecutionStatus,
  })
}

export function queryTabActions() {
  return {
    getTabState,
    setContent,
    setSelectedText,
    setFilePath,
    setCursorPosition,
    cleanupTab,
    cleanupConnection,
    setTabStatus,
  }
}
