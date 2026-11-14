import { type ReactNode } from 'react'
import { useConnectionStore } from '../../stores/connection-store'
import { getActiveResult, useQueryStore } from '../../stores/query-store'
import { useTableDataStore } from '../../stores/table-data-store'
import { useSchemaIndexStore } from '../../stores/schema-index-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useUpdateStore } from '../../stores/update-store'
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator'
import styles from './StatusBar.module.css'
import {
  hasAnyActivity,
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
    <div className={styles.activity} aria-live="polite">
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
  const hasActivity = hasAnyActivity(activity)
  const hasUpdateIndicator = updateIndicator !== null
  return (
    <div className={styles.right}>
      <ActivityRegion activity={activity} />
      {/* Query row count, Exec and Total sit outside the polite live region so count
          changes aren't re-announced (wireframe 3). */}
      {activity.queryInfo && (
        <QueryInfo result={activity.queryInfo.result} rowCount={activity.queryInfo.rowCount} />
      )}
      {hasActivity && hasUpdateIndicator && <span className={styles.divider} aria-hidden="true" />}
      {updateIndicator}
      {(hasActivity || hasUpdateIndicator) && (
        <span className={styles.divider} aria-hidden="true" />
      )}
      <span className={styles.statusText}>{serverVersion}</span>
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
    <div className={styles.statusBar} data-testid="status-bar">
      <div className={styles.left}>
        <div className={styles.segment}>
          <ConnectionStatusIndicator status={activeConnection.status} size={10} />
          <span className={styles.statusText}>{statusLabel[activeConnection.status]}</span>
        </div>
        <span className={styles.divider} aria-hidden="true" />
        <span className={`${styles.statusText} ${styles.connName}`}>
          {activeConnection.profile.name} — {activeConnection.profile.host}:
          {activeConnection.profile.port}
        </span>
      </div>

      <div className={styles.spacer} />

      <StatusBarTrailing
        activity={activity}
        updateIndicator={updateIndicator}
        serverVersion={activeConnection.serverVersion}
      />
    </div>
  )
}
