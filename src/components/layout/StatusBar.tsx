import { type ReactNode } from 'react'
import { useConnectionStore } from '../../stores/connection-store'
import { getActiveResult, useQueryStore } from '../../stores/query-store'
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
  QueryInfo,
  QueryRunningInfo,
  TableDataInfo,
  UpdateIndicator,
} from './status-bar/StatusIndicators'

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
      {activity.tableRows !== null && <TableDataInfo visibleRows={activity.tableRows} />}
    </div>
  )
}

interface StatusBarTrailingProps {
  activity: StatusActivity
  updateIndicator: ReactNode
  serverVersion: string
}

function StatusBarTrailing({ activity, updateIndicator, serverVersion }: StatusBarTrailingProps) {
  return (
    <div className={STATUS_BAR_RIGHT}>
      <ActivityRegion activity={activity} />
      {activity.queryInfo && (
        <QueryInfo result={activity.queryInfo.result} rowCount={activity.queryInfo.rowCount} />
      )}
      {updateIndicator}
      <span className={STATUS_TEXT}>{serverVersion}</span>
    </div>
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

  const { activeWorkspaceTabId, isQueryEditorTab, activeTableDataTabId } =
    useActiveWorkspaceTab(connectionTabId)

  const queryTabStatus = useQueryStore((state) =>
    activeWorkspaceTabId ? state.tabs[activeWorkspaceTabId]?.tabStatus : undefined
  )
  const activeResultState = useQueryStore((state) =>
    activeWorkspaceTabId ? getActiveResult(state.tabs[activeWorkspaceTabId]) : null
  )
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
    queryPane: {
      isActive: isQueryEditorTab && !isShowingTableData,
      result: activeResultState,
      tabStatus: queryTabStatus,
    },
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
        updateIndicator={updateIndicator}
        serverVersion={activeConnection.serverVersion}
      />
    </div>
  )
}
