import { useConnectionStore } from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useQueryStore, getActiveResult } from '../../stores/query-store'
import { useThemeStore } from '../../stores/theme-store'
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator'
import styles from './StatusBar.module.css'

const statusLabel: Record<string, string> = {
  connected: 'Connected',
  reconnecting: 'Reconnecting...',
  disconnected: 'Disconnected',
}

export function StatusBar() {
  const activeConnections = useConnectionStore((s) => s.activeConnections)
  const connectionTabId = useConnectionStore((s) => s.activeTabId)
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme)

  // Active workspace tab ID for the current connection
  const activeWorkspaceTabId = useWorkspaceStore((s) =>
    connectionTabId ? (s.activeTabByConnection[connectionTabId] ?? null) : null
  )

  // Check the type of the active workspace tab
  const activeWorkspaceTabType = useWorkspaceStore((s) => {
    if (!connectionTabId || !activeWorkspaceTabId) return null
    const tabs = s.tabsByConnection[connectionTabId]
    return tabs?.find((t) => t.id === activeWorkspaceTabId)?.type ?? null
  })

  // Get query state for the active workspace tab — read from active result
  const queryState = useQueryStore((s) =>
    activeWorkspaceTabId ? (s.tabs[activeWorkspaceTabId] ?? null) : null
  )
  const activeResultState = useQueryStore((s) =>
    activeWorkspaceTabId ? getActiveResult(s.tabs[activeWorkspaceTabId]) : null
  )

  const activeConnection = connectionTabId ? activeConnections[connectionTabId] : null

  const isQueryEditorTab = activeWorkspaceTabType === 'query-editor'

  // Show query info only for query-editor tabs when the active result is successful
  // (not the tab-level status, which may be 'success' even for partial-error multi-results)
  const showQueryInfo = isQueryEditorTab && activeResultState?.resultStatus === 'success'

  // Show running indicator for query-editor tabs with tabStatus === 'running'
  const showRunningInfo = isQueryEditorTab && queryState?.tabStatus === 'running'

  if (!activeConnection) {
    return (
      <div className={styles.statusBar} data-testid="status-bar">
        <span className={styles.statusText}>Ready</span>
      </div>
    )
  }

  return (
    <div className={styles.statusBar} data-testid="status-bar">
      <div className={styles.statusLeft}>
        <ConnectionStatusIndicator status={activeConnection.status} size={10} />
        <span className={styles.statusText}>{statusLabel[activeConnection.status]}</span>
      </div>
      {showRunningInfo && (
        <div className={styles.queryRunningInfo} data-testid="query-running-info">
          <span className={styles.queryRunningSpinner} />
          <span className={styles.queryRunningText}>Running...</span>
        </div>
      )}
      {showQueryInfo && activeResultState && (
        <div className={styles.queryInfo} data-testid="query-info">
          {resolvedTheme === 'dark' ? (
            <>
              <span className={styles.queryInfoItem} data-testid="query-rows">
                Rows: {activeResultState.totalRows}
              </span>
              <span className={styles.queryInfoItem} data-testid="query-time">
                {activeResultState.executionTimeMs}ms
              </span>
            </>
          ) : (
            <>
              <span
                className={`${styles.queryInfoItem} ${styles.queryInfoTime}`}
                data-testid="query-time"
              >
                QUERY: {activeResultState.executionTimeMs}ms
              </span>
              <span
                className={`${styles.queryInfoItem} ${styles.queryInfoRows}`}
                data-testid="query-rows"
              >
                ROWS: {activeResultState.totalRows}
              </span>
            </>
          )}
        </div>
      )}
      <div className={styles.statusCenter}>
        <span className={styles.statusText}>
          {activeConnection.profile.name} — {activeConnection.profile.host}:
          {activeConnection.profile.port}
        </span>
      </div>
      <div className={styles.statusRight}>
        <span className={styles.statusText}>{activeConnection.serverVersion}</span>
      </div>
    </div>
  )
}
