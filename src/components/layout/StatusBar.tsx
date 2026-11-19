import type { DataViewSurfaceRef } from '../../stores/data-view/data-view-types'
import { type ReactNode } from 'react'
import { useConnectionStore } from '../../stores/connection-store'
import { getActiveResult, useQueryStore, activeQuerySurfaceRef } from '../../stores/query-store'
import { useTableDataStore } from '../../stores/table-data-store'
import { useSchemaIndexStore } from '../../stores/schema-index-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useUpdateStore } from '../../stores/update-store'
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator'
import { joinClassNames } from '../../lib/class-names'
import {
  STATUS_BAR,
  STATUS_BAR_ACTIVITY,
  STATUS_BAR_LEFT,
  STATUS_BAR_RIGHT,
  STATUS_BAR_SPACER,
  STATUS_TEXT,
} from '../../lib/class-names-status-bar'
import {
  resolveIndexingProgress,
  resolveStatusActivity,
  statusLabel,
  useActiveWorkspaceTab,
  useIndexFlash,
  type StatusActivity,
} from './status-bar/status-bar-model'
import {
  IdleStatusBar,
  IndexBuildingIndicator,
  IndexFlashIndicator,
  PendingWorkInfo,
  QueryInfo,
  QueryRunningInfo,
  RunProgressInfo,
  TableDataInfo,
  UpdateIndicator,
} from './status-bar/StatusIndicators'
import { visibleRunTabId, type VisibleRun } from './status-bar/run-progress-model'
import { useWorkspaceStore } from '../../stores/workspace-store'

function ActivityRegion({ activity }: { activity: StatusActivity }) {
  return (
    <div className={STATUS_BAR_ACTIVITY} aria-live="polite">
      {activity.buildingIndex && (
        <IndexBuildingIndicator
          indexState={activity.buildingIndex}
          progress={resolveIndexingProgress(activity.buildingIndex)}
        />
      )}
      {activity.flash && (
        <IndexFlashIndicator
          flashType={activity.flash.flashType}
          fadingOut={activity.flash.fadingOut}
        />
      )}
      {activity.showRunningInfo && <QueryRunningInfo />}
    </div>
  )
}

interface StatusBarTrailingProps {
  activity: StatusActivity
  runProgress: ReactNode
  updateIndicator: ReactNode
  serverVersion: string
  onCancelPendingWork: () => void
}

function StatusBarTrailing(props: StatusBarTrailingProps) {
  const { activity, updateIndicator, serverVersion } = props
  return (
    <div className={STATUS_BAR_RIGHT}>
      <ActivityRegion activity={activity} />
      {props.runProgress}
      {activity.pendingWork && (
        <PendingWorkInfo work={activity.pendingWork} onCancel={props.onCancelPendingWork} />
      )}
      {activity.tableInfo && <TableDataInfo info={activity.tableInfo} />}
      {activity.queryInfo && (
        <QueryInfo result={activity.queryInfo.result} rowCount={activity.queryInfo.rowCount} />
      )}
      {updateIndicator}
      <span className={STATUS_TEXT}>{serverVersion}</span>
    </div>
  )
}

function cancelPendingRowAction(
  tabId: string | null,
  cancelRowAction: (ref: DataViewSurfaceRef) => void
) {
  if (!tabId) return
  cancelRowAction(activeQuerySurfaceRef(tabId))
}

function useVisibleRun(activeWorkspaceTabId: string | null): VisibleRun | null {
  const runTabId = useQueryStore((state) => visibleRunTabId(state.tabs, activeWorkspaceTabId))
  const runTab = useQueryStore((state) => (runTabId ? state.tabs[runTabId] : undefined))
  const connectionId = runTab?.connectionId ?? ''
  const tabLabel = useWorkspaceStore(
    (state) =>
      (state.tabsByConnection[connectionId] ?? []).find((tab) => tab.id === runTabId)?.label ?? ''
  )
  if (!runTabId) return null
  const runExport = runTab?.runExport
  if (!runExport) return null
  return {
    connectionId: connectionId,
    tabId: runTabId,
    tabLabel: tabLabel,
    progress: runExport.progress,
    isRunTabActive: runTabId === activeWorkspaceTabId,
    isCancelling: runTab.isCancelling,
  }
}

function useActiveQueryTab(activeWorkspaceTabId: string | null) {
  const tabStatus = useQueryStore((state) =>
    activeWorkspaceTabId ? state.tabs[activeWorkspaceTabId]?.tabStatus : undefined
  )
  const isExporting = useQueryStore((state) =>
    activeWorkspaceTabId ? state.tabs[activeWorkspaceTabId]?.runExport?.isActive === true : false
  )
  const result = useQueryStore((state) =>
    activeWorkspaceTabId ? getActiveResult(state.tabs[activeWorkspaceTabId]) : null
  )
  return { tabStatus, isExporting, result }
}

function RunProgressSlot({ activeWorkspaceTabId }: { activeWorkspaceTabId: string | null }) {
  const run = useVisibleRun(activeWorkspaceTabId)
  const cancelQuery = useQueryStore((state) => state.cancelQuery)
  if (!run) return null
  return (
    <RunProgressInfo run={run} onCancel={() => void cancelQuery(run.connectionId, run.tabId)} />
  )
}

function updateIndicatorFor(updateStatus: string, onOpenUpdates: () => void): ReactNode {
  if (updateStatus !== 'available') return null
  return <UpdateIndicator onOpenUpdates={onOpenUpdates} />
}

export function StatusBar() {
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const connectionTabId = useConnectionStore((state) => state.activeTabId)
  const updateStatus = useUpdateStore((state) => state.status)
  const openSettingsDialog = useSettingsStore((state) => state.openDialog)
  const cancelRowAction = useQueryStore((state) => state.cancelRowAction)

  const { activeWorkspaceTabId, isQueryEditorTab, activeTableDataTabId } =
    useActiveWorkspaceTab(connectionTabId)

  const activeQueryTab = useActiveQueryTab(activeWorkspaceTabId)
  const activeTableDataState = useTableDataStore((state) =>
    activeTableDataTabId ? (state.tabs[activeTableDataTabId] ?? null) : null
  )

  const indexState = useSchemaIndexStore((state) =>
    connectionTabId ? state.connections[connectionTabId] : undefined
  )
  const flash = useIndexFlash(indexState?.status)

  const activeConnection = connectionTabId ? activeConnections[connectionTabId] : null
  const isShowingTableData = activeTableDataTabId !== null

  const activity = resolveStatusActivity({
    indexState: indexState,
    flash: flash,
    queryPane: { isActive: isQueryEditorTab && !isShowingTableData, ...activeQueryTab },
    tableData: activeTableDataState,
  })

  const updateIndicator = updateIndicatorFor(updateStatus, () => openSettingsDialog('updates'))

  if (!activeConnection) {
    return <IdleStatusBar updateIndicator={updateIndicator} />
  }

  return (
    <div className={STATUS_BAR} data-testid="status-bar">
      <div className={STATUS_BAR_LEFT}>
        <div className="flex shrink-0 items-center gap-1.5">
          <ConnectionStatusIndicator status={activeConnection.status} size={10} />
          <span className={STATUS_TEXT}>{statusLabel[activeConnection.status]}</span>
        </div>
        <span className={joinClassNames([STATUS_TEXT, 'min-w-0 truncate'])}>
          {activeConnection.profile.name} — {activeConnection.profile.host}:
          {activeConnection.profile.port}
        </span>
      </div>

      <div className={STATUS_BAR_SPACER} />

      <StatusBarTrailing
        activity={activity}
        runProgress={<RunProgressSlot activeWorkspaceTabId={activeWorkspaceTabId} />}
        updateIndicator={updateIndicator}
        serverVersion={activeConnection.serverVersion}
        onCancelPendingWork={() => cancelPendingRowAction(activeWorkspaceTabId, cancelRowAction)}
      />
    </div>
  )
}
