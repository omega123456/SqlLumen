import { useEffect, useRef, useState } from 'react'
import { Database, CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { useConnectionStore } from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useQueryStore, getActiveResult } from '../../stores/query-store'
import { useThemeStore } from '../../stores/theme-store'
import { useSchemaIndexStore } from '../../stores/schema-index-store'
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

  // Schema index status for the active connection session
  const indexState = useSchemaIndexStore((s) =>
    connectionTabId ? s.connections[connectionTabId] : undefined
  )
  const indexStatus = indexState?.status

  // Flash logic — show brief completion/error indicators after status transitions.
  // The synchronous setState calls within the effect match the pattern used in
  // Sidebar.tsx and AiChatInput.tsx for responding to external store changes.
  const [flashType, setFlashType] = useState<'ready' | 'error' | null>(null)
  const [fadingOut, setFadingOut] = useState(false)
  const prevStatusRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    const prevStatus = prevStatusRef.current
    prevStatusRef.current = indexStatus

    let flashTimer: ReturnType<typeof setTimeout> | undefined
    let fadeTimer: ReturnType<typeof setTimeout> | undefined

    if (
      (indexStatus === 'ready' || indexStatus === 'error') &&
      prevStatus !== undefined &&
      prevStatus !== indexStatus
    ) {
      setFlashType(indexStatus)
      setFadingOut(false)
      const duration = indexStatus === 'ready' ? 2000 : 3000
      flashTimer = setTimeout(() => {
        setFadingOut(true)
        fadeTimer = setTimeout(() => {
          setFlashType(null)
          setFadingOut(false)
        }, 500)
      }, duration)
    } else if (indexStatus === 'building') {
      setFlashType(null)
      setFadingOut(false)
    }

    return () => {
      if (flashTimer !== undefined) clearTimeout(flashTimer)
      if (fadeTimer !== undefined) clearTimeout(fadeTimer)
    }
  }, [indexStatus])

  const activeConnection = connectionTabId ? activeConnections[connectionTabId] : null

  const isQueryEditorTab = activeWorkspaceTabType === 'query-editor'

  // Show query info only for query-editor tabs when the active result is successful
  // (not the tab-level status, which may be 'success' even for partial-error multi-results)
  const showQueryInfo = isQueryEditorTab && activeResultState?.resultStatus === 'success'

  // Show running indicator for query-editor tabs with tabStatus === 'running'
  const showRunningInfo = isQueryEditorTab && queryState?.tabStatus === 'running'

  const showIndexBuilding = indexStatus === 'building'
  const showIndexReady = flashType === 'ready' && !showIndexBuilding
  const showIndexError = flashType === 'error' && !showIndexBuilding

  const indexPhase = indexState?.phase ?? null
  const hasTableTotals = (indexState?.tablesTotal ?? 0) > 0
  const isEmbeddingPhase = indexPhase === 'embedding' && (indexState?.tablesTotal ?? 0) > 0
  const isFinalizingPhase = indexPhase === 'finalizing' && hasTableTotals
  const isCountBasedProgressPhase = isEmbeddingPhase || isFinalizingPhase
  const isDark = resolvedTheme === 'dark'

  function buildIndexingLabel(): string {
    if (!indexState) {
      return isDark ? 'Preparing index...' : 'PREPARING INDEX...'
    }
    if (isFinalizingPhase) {
      return isDark
        ? `Finalizing ${indexState.tablesDone}/${indexState.tablesTotal}`
        : `FINALIZING: ${indexState.tablesDone}/${indexState.tablesTotal}`
    }
    if (isEmbeddingPhase) {
      return isDark
        ? `Indexing ${indexState.tablesDone}/${indexState.tablesTotal}`
        : `INDEXING: ${indexState.tablesDone}/${indexState.tablesTotal} TABLES`
    }
    // loading_schema or unknown pre-progress phase
    if (indexPhase === 'loading_schema' && indexState.tablesDone > 0) {
      return isDark
        ? `Reading schema (${indexState.tablesDone} tables)...`
        : `READING SCHEMA (${indexState.tablesDone} TABLES)...`
    }
    return isDark ? 'Reading schema...' : 'READING SCHEMA...'
  }

  const indexingLabel = buildIndexingLabel()

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
      <div aria-live="polite">
        {showIndexBuilding &&
          indexState &&
          (isCountBasedProgressPhase ? (
            <div
              className={styles.indexingIndicator}
              data-testid="indexing-indicator"
              data-phase={indexPhase ?? 'preparing'}
              role="progressbar"
              aria-valuenow={indexState.tablesDone}
              aria-valuemin={0}
              aria-valuemax={indexState.tablesTotal}
              aria-valuetext={`Schema indexing progress: ${indexState.tablesDone} of ${indexState.tablesTotal}`}
            >
              <Database
                size={12}
                className={`${styles.indexingIcon} ${styles.indexingIconAnimated}`}
              />
              <span className={styles.indexingText} data-testid="indexing-text">
                {indexingLabel}
              </span>
            </div>
          ) : (
            <div
              className={styles.indexingIndicator}
              data-testid="indexing-indicator"
              data-phase={indexPhase ?? 'preparing'}
              role="status"
              aria-label={indexingLabel}
            >
              <Database
                size={12}
                className={`${styles.indexingIcon} ${styles.indexingIconAnimated}`}
              />
              <span className={styles.indexingText} data-testid="indexing-text">
                {indexingLabel}
              </span>
            </div>
          ))}
        {showIndexReady && (
          <div
            className={`${styles.indexingIndicator} ${fadingOut ? styles.indexingFadeOut : ''}`}
            data-testid="indexing-ready"
          >
            <CheckCircle
              size={12}
              weight="fill"
              className={`${styles.indexingIcon} ${styles.indexingReady}`}
            />
            <span className={`${styles.indexingText} ${styles.indexingReady}`}>
              {resolvedTheme === 'dark' ? 'Index ready' : 'INDEX READY'}
            </span>
          </div>
        )}
        {showIndexError && (
          <div
            className={`${styles.indexingIndicator} ${fadingOut ? styles.indexingFadeOut : ''}`}
            data-testid="indexing-error"
          >
            <WarningCircle
              size={12}
              weight="fill"
              className={`${styles.indexingIcon} ${styles.indexingError}`}
            />
            <span className={`${styles.indexingText} ${styles.indexingError}`}>
              {resolvedTheme === 'dark' ? 'Index error' : 'INDEX ERROR'}
            </span>
          </div>
        )}
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
