import { formatBytes } from '../../../lib/blob-utils'
import { formatRowsCount } from '../../../lib/format-row-count'
import { useConnectionStore } from '../../../stores/connection-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { TabQueryState } from '../../../stores/query-store'
import type { RunExportProgress, RunPhase } from '../../../types/run-export'

const STARTING_LABEL = 'Starting the run…'
const CANCELLING_LABEL = 'Cancelling…'
const LABEL_SEPARATOR = ' · '

export interface VisibleRun {
  connectionId: string
  tabId: string
  tabLabel: string
  progress: RunExportProgress | null
  isRunTabActive: boolean
  isCancelling: boolean
}

const PHASE_LABELS: Record<RunPhase, (progress: RunExportProgress) => string> = {
  queued: () => 'Waiting for the editor session',
  running: (progress) =>
    `Running statement ${progress.statementNumber} of ${progress.statementCount}`,
  writing: (progress) =>
    [
      `Writing statement ${progress.statementNumber} of ${progress.statementCount}`,
      formatRowsCount(progress.rowsWritten),
      formatBytes(progress.bytesWritten),
    ].join(LABEL_SEPARATOR),
}

const PHASE_ANNOUNCEMENTS: Record<RunPhase, string> = {
  queued: 'Run waiting for the editor session',
  running: 'Run started',
  writing: 'Writing run results',
}

function hasActiveRun(tab: TabQueryState | undefined): boolean {
  return tab?.runExport?.isActive === true
}

export function visibleRunTabId(
  tabs: Record<string, TabQueryState>,
  activeTabId: string | null
): string | null {
  const isActiveTabRunning = activeTabId !== null && hasActiveRun(tabs[activeTabId])
  if (isActiveTabRunning) return activeTabId
  const runningTabId = Object.keys(tabs).find((tabId) => hasActiveRun(tabs[tabId]))
  return runningTabId ?? null
}

function progressLabel(run: VisibleRun): string {
  if (run.isCancelling) return CANCELLING_LABEL
  if (!run.progress) return STARTING_LABEL
  return PHASE_LABELS[run.progress.phase](run.progress)
}

export function runProgressLabel(run: VisibleRun): string {
  const label = progressLabel(run)
  if (run.isRunTabActive) return label
  return `${run.tabLabel}${LABEL_SEPARATOR}${label}`
}

export function runProgressAnnouncement(run: VisibleRun): string {
  if (run.isCancelling) return CANCELLING_LABEL
  if (!run.progress) return STARTING_LABEL
  return PHASE_ANNOUNCEMENTS[run.progress.phase]
}

export function showRunTab(run: VisibleRun): void {
  useConnectionStore.getState().switchTab(run.connectionId)
  useWorkspaceStore.getState().requestActivateTab(run.tabId)
}
