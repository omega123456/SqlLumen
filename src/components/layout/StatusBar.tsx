import { useEffect, useRef, useState } from 'react'
import { Database, CheckCircle, WarningCircle, ArrowsClockwise } from '@phosphor-icons/react'
import { useConnectionStore } from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useQueryStore, getActiveResult } from '../../stores/query-store'
import { useTableDataStore } from '../../stores/table-data-store'
import { useSchemaIndexStore } from '../../stores/schema-index-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useUpdateStore } from '../../stores/update-store'
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator'
import { formatRowCountParts } from '../../lib/format-row-count'
import { Button } from '../common/Button'
import styles from './StatusBar.module.css'

const READY_FLASH_DURATION_MS = 2000
const STATUS_FLASH_DURATION_MS = 3000
const FLASH_FADE_OUT_MS = 500

const statusLabel: Record<string, string> = {
  connected: 'Connected',
  reconnecting: 'Reconnecting...',
  disconnected: 'Disconnected',
}

export function StatusBar() {
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const connectionTabId = useConnectionStore((state) => state.activeTabId)
  const updateStatus = useUpdateStore((state) => state.status)
  const openSettingsDialog = useSettingsStore((state) => state.openDialog)

  // Active workspace tab ID for the current connection
  const activeWorkspaceTabId = useWorkspaceStore((state) =>
    connectionTabId ? (state.activeTabByConnection[connectionTabId] ?? null) : null
  )

  // Check the type of the active workspace tab
  const activeWorkspaceTabType = useWorkspaceStore((state) => {
    if (!connectionTabId || !activeWorkspaceTabId) return null
    const tabs = state.tabsByConnection[connectionTabId]
    return tabs?.find((tab) => tab.id === activeWorkspaceTabId)?.type ?? null
  })

  const activeTableDataTabId = useWorkspaceStore((state) => {
    if (!connectionTabId || !activeWorkspaceTabId) return null

    const tabs = state.tabsByConnection[connectionTabId] ?? []
    const activeTab = tabs.find((tab) => tab.id === activeWorkspaceTabId) ?? null
    if (!activeTab) return null

    if (activeTab.type === 'table-data') {
      return activeTab.id
    }

    if (activeTab.type !== 'query-editor') {
      return null
    }

    const queryTab = useQueryStore.getState().tabs[activeTab.id]
    if (queryTab?.activeBottomPanelItem?.type !== 'table-data') {
      return null
    }

    return queryTab.activeBottomPanelItem.tabId
  })

  // Get query state for the active workspace tab — read from active result
  const queryState = useQueryStore((state) =>
    activeWorkspaceTabId ? (state.tabs[activeWorkspaceTabId] ?? null) : null
  )
  const activeResultState = useQueryStore((state) =>
    activeWorkspaceTabId ? getActiveResult(state.tabs[activeWorkspaceTabId]) : null
  )
  const activeTableDataState = useTableDataStore((state) =>
    activeTableDataTabId ? (state.tabs[activeTableDataTabId] ?? null) : null
  )

  // Schema index status for the active connection session
  const indexState = useSchemaIndexStore((state) =>
    connectionTabId ? state.connections[connectionTabId] : undefined
  )
  const indexStatus = indexState?.status

  // Flash logic — show brief completion/error indicators after status transitions.
  const [flashType, setFlashType] = useState<'ready' | 'error' | null>(null)
  const [fadingOut, setFadingOut] = useState(false)
  const previousStatusRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    const previousStatus = previousStatusRef.current
    previousStatusRef.current = indexStatus

    let frame: number | undefined
    let flashTimer: ReturnType<typeof setTimeout> | undefined
    let fadeTimer: ReturnType<typeof setTimeout> | undefined

    if (
      (indexStatus === 'ready' || indexStatus === 'error') &&
      previousStatus !== undefined &&
      previousStatus !== indexStatus
    ) {
      frame = requestAnimationFrame(() => {
        setFlashType(indexStatus)
        setFadingOut(false)
        const duration =
          indexStatus === 'ready' ? READY_FLASH_DURATION_MS : STATUS_FLASH_DURATION_MS
        flashTimer = setTimeout(() => {
          setFadingOut(true)
          fadeTimer = setTimeout(() => {
            setFlashType(null)
            setFadingOut(false)
          }, FLASH_FADE_OUT_MS)
        }, duration)
      })
    } else if (indexStatus === 'building') {
      frame = requestAnimationFrame(() => {
        setFlashType(null)
        setFadingOut(false)
      })
    }

    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      if (flashTimer !== undefined) clearTimeout(flashTimer)
      if (fadeTimer !== undefined) clearTimeout(fadeTimer)
    }
  }, [indexStatus])

  const activeConnection = connectionTabId ? activeConnections[connectionTabId] : null

  const isQueryEditorTab = activeWorkspaceTabType === 'query-editor'
  const isShowingTableData = activeTableDataTabId !== null

  // Show query info only for query-editor tabs when the active result is successful
  // (not the tab-level status, which may be 'success' even for partial-error multi-results)
  const showQueryInfo =
    isQueryEditorTab && !isShowingTableData && activeResultState?.resultStatus === 'success'

  // Show running indicator for query-editor tabs with tabStatus === 'running'
  const showRunningInfo =
    isQueryEditorTab && !isShowingTableData && queryState?.tabStatus === 'running'

  const showTableInfo =
    isShowingTableData &&
    activeTableDataState?.viewMode === 'grid' &&
    activeTableDataState.columns.length > 0 &&
    activeTableDataState.error === null

  const visibleTableRows = activeTableDataState?.rows.length ?? 0

  // The same unified row-count string as the result toolbar (wireframe 3).
  const queryRowCount = activeResultState
    ? formatRowCountParts({
        viewRowCount: activeResultState.viewRowCount,
        totalRows: activeResultState.totalRows,
        isFiltered: activeResultState.filterModel.length > 0,
        truncated: activeResultState.truncated,
        autoLimitApplied: activeResultState.autoLimitApplied,
        appliedRowLimit: activeResultState.appliedRowLimit,
      })
    : null

  const showIndexBuilding = indexStatus === 'building'
  const showIndexReady = flashType === 'ready' && !showIndexBuilding
  const showIndexError = flashType === 'error' && !showIndexBuilding

  const indexPhase = indexState?.phase ?? null
  const hasTableTotals = (indexState?.tablesTotal ?? 0) > 0
  const isEmbeddingPhase = indexPhase === 'embedding' && (indexState?.tablesTotal ?? 0) > 0
  const isFinalizingPhase = indexPhase === 'finalizing' && hasTableTotals
  const isCountBasedProgressPhase = isEmbeddingPhase || isFinalizingPhase

  function buildIndexingLabel(): string {
    if (!indexState) {
      return 'Preparing index...'
    }
    if (isFinalizingPhase) {
      return `Finalizing ${indexState.tablesDone}/${indexState.tablesTotal}`
    }
    if (isEmbeddingPhase) {
      return `Indexing ${indexState.tablesDone}/${indexState.tablesTotal}`
    }
    // loading_schema or unknown pre-progress phase
    if (indexPhase === 'loading_schema' && indexState.tablesDone > 0) {
      return `Reading schema (${indexState.tablesDone} tables)...`
    }
    return 'Reading schema...'
  }

  const indexingLabel = buildIndexingLabel()

  const updateIndicator =
    updateStatus === 'available' ? (
      <Button
        variant="bare"
        className={styles.updateButton}
        data-testid="status-bar-update-indicator"
        aria-label="Update available, click to open update settings"
        onClick={() => openSettingsDialog('updates')}
      >
        <ArrowsClockwise size={12} weight="fill" className={styles.indexingIcon} />
        <span className={styles.updateButtonText}>Update available</span>
      </Button>
    ) : null

  const hasActivity =
    showIndexBuilding ||
    showIndexReady ||
    showIndexError ||
    showRunningInfo ||
    showQueryInfo ||
    showTableInfo

  if (!activeConnection) {
    return (
      <div className={styles.statusBar} data-testid="status-bar">
        <div className={styles.left}>
          <span className={styles.statusText}>Ready</span>
        </div>
        <div className={styles.spacer} />
        <div className={styles.right}>
          <div className={styles.activity} aria-live="polite">
            {updateIndicator}
          </div>
        </div>
      </div>
    )
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

      <div className={styles.right}>
        <div className={styles.activity} aria-live="polite">
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
              <span className={`${styles.indexingText} ${styles.indexingReady}`}>Index ready</span>
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
              <span className={`${styles.indexingText} ${styles.indexingError}`}>Index error</span>
            </div>
          )}
          {showRunningInfo && (
            <div className={styles.queryRunningInfo} data-testid="query-running-info">
              <span className={styles.queryRunningSpinner} />
              <span className={styles.queryRunningText}>Running...</span>
            </div>
          )}
          {showTableInfo && (
            <div className={styles.queryInfo} data-testid="table-data-info">
              <span className={styles.queryInfoItem} data-testid="table-data-rows">
                <span className={styles.queryInfoLabel}>Rows</span>{' '}
                <b className={styles.queryInfoTime}>{visibleTableRows}</b>
              </span>
            </div>
          )}
        </div>
        {/* Query row count, Exec and Total sit outside the polite live region so count
            changes aren't re-announced (wireframe 3). */}
        {showQueryInfo && activeResultState && queryRowCount && (
          <div className={styles.queryInfo} data-testid="query-info">
            <span className={styles.queryInfoItem} data-testid="query-rows">
              <b className={`${styles.queryInfoTime} ${styles.queryRowCount}`}>
                {queryRowCount.segmentKind === 'truncated' && (
                  <WarningCircle
                    size={12}
                    weight="fill"
                    className={styles.queryRowCountWarning}
                    aria-hidden="true"
                    data-testid="query-rows-truncated-icon"
                  />
                )}
                {queryRowCount.segment
                  ? `${queryRowCount.count} · ${queryRowCount.segment}`
                  : queryRowCount.count}
              </b>
            </span>
            <span className={styles.queryInfoItem} data-testid="query-time">
              <span className={styles.queryInfoLabel}>Exec</span>{' '}
              <b className={styles.queryInfoTime}>{activeResultState.executionTimeMs} ms</b>
            </span>
            <span className={styles.queryInfoItem} data-testid="query-total-time">
              <span className={styles.queryInfoLabel}>Total</span>{' '}
              <b className={styles.queryInfoTime}>{activeResultState.totalTimeMs} ms</b>
            </span>
          </div>
        )}
        {hasActivity && updateIndicator && <span className={styles.divider} aria-hidden="true" />}
        {updateIndicator}
        {(hasActivity || updateIndicator) && <span className={styles.divider} aria-hidden="true" />}
        <span className={styles.statusText}>{activeConnection.serverVersion}</span>
      </div>
    </div>
  )
}
