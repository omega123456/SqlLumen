import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Database, CheckCircle, WarningCircle, ArrowsClockwise } from '@phosphor-icons/react'
import { useConnectionStore } from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useQueryStore, getActiveResult, type SingleResultState } from '../../stores/query-store'
import { useTableDataStore } from '../../stores/table-data-store'
import { useSchemaIndexStore, type ConnectionIndexState } from '../../stores/schema-index-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useUpdateStore } from '../../stores/update-store'
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator'
import { formatRowCountParts } from '../../lib/format-row-count'
import { Button } from '../common/Button'
import type { TableDataTabState, WorkspaceTab } from '../../types/schema'
import styles from './StatusBar.module.css'

const READY_FLASH_DURATION_MS = 2000
const STATUS_FLASH_DURATION_MS = 3000
const FLASH_FADE_OUT_MS = 500
const PREPARING_PHASE = 'preparing'

const statusLabel: Record<string, string> = {
  connected: 'Connected',
  reconnecting: 'Reconnecting...',
  disconnected: 'Disconnected',
}

type FlashType = 'ready' | 'error'

const FLASH_DURATION_MS: Record<FlashType, number> = {
  ready: READY_FLASH_DURATION_MS,
  error: STATUS_FLASH_DURATION_MS,
}

const INDEX_FLASH_DISPLAY: Record<
  FlashType,
  { testId: string; icon: typeof CheckCircle; toneClassName: string; text: string }
> = {
  ready: {
    testId: 'indexing-ready',
    icon: CheckCircle,
    toneClassName: styles.indexingReady,
    text: 'Index ready',
  },
  error: {
    testId: 'indexing-error',
    icon: WarningCircle,
    toneClassName: styles.indexingError,
    text: 'Index error',
  },
}

type ScheduledFlash = {
  frame: number | undefined
  flashTimer: ReturnType<typeof setTimeout> | undefined
  fadeTimer: ReturnType<typeof setTimeout> | undefined
}

function isFlashStatus(status: string | undefined): status is FlashType {
  return status === 'ready' || status === 'error'
}

function isFlashTransition(
  previousStatus: string | undefined,
  status: string | undefined
): status is FlashType {
  if (!isFlashStatus(status)) return false
  return previousStatus !== undefined && previousStatus !== status
}

function cancelScheduledFlash(scheduled: ScheduledFlash): void {
  if (scheduled.frame !== undefined) cancelAnimationFrame(scheduled.frame)
  if (scheduled.flashTimer !== undefined) clearTimeout(scheduled.flashTimer)
  if (scheduled.fadeTimer !== undefined) clearTimeout(scheduled.fadeTimer)
}

function useIndexFlash(indexStatus: string | undefined) {
  const [flashType, setFlashType] = useState<FlashType | null>(null)
  const [fadingOut, setFadingOut] = useState(false)
  const previousStatusRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    const previousStatus = previousStatusRef.current
    previousStatusRef.current = indexStatus

    const scheduled: ScheduledFlash = {
      frame: undefined,
      flashTimer: undefined,
      fadeTimer: undefined,
    }

    if (isFlashTransition(previousStatus, indexStatus)) {
      scheduled.frame = requestAnimationFrame(() => {
        setFlashType(indexStatus)
        setFadingOut(false)
        scheduled.flashTimer = setTimeout(() => {
          setFadingOut(true)
          scheduled.fadeTimer = setTimeout(() => {
            setFlashType(null)
            setFadingOut(false)
          }, FLASH_FADE_OUT_MS)
        }, FLASH_DURATION_MS[indexStatus])
      })
    }
    if (indexStatus === 'building') {
      scheduled.frame = requestAnimationFrame(() => {
        setFlashType(null)
        setFadingOut(false)
      })
    }

    return () => cancelScheduledFlash(scheduled)
  }, [indexStatus])

  return { flashType: flashType, fadingOut: fadingOut }
}

function findTab(tabs: WorkspaceTab[] | undefined, tabId: string): WorkspaceTab | null {
  return tabs?.find((tab) => tab.id === tabId) ?? null
}

interface ActiveTabLocation {
  connectionTabId: string | null
  tabId: string | null
}

function findActiveTab(
  tabsByConnection: Record<string, WorkspaceTab[]>,
  location: ActiveTabLocation
): WorkspaceTab | null {
  if (!location.connectionTabId) return null
  if (!location.tabId) return null
  return findTab(tabsByConnection[location.connectionTabId], location.tabId)
}

function tableDataTabShownIn(activeTab: WorkspaceTab | null): string | null {
  if (!activeTab) return null
  if (activeTab.type === 'table-data') return activeTab.id
  if (activeTab.type !== 'query-editor') return null
  const bottomPanelItem = useQueryStore.getState().tabs[activeTab.id]?.activeBottomPanelItem
  if (bottomPanelItem?.type !== 'table-data') return null
  return bottomPanelItem.tabId
}

interface IndexingProgress {
  phase: ConnectionIndexState['phase']
  isCountBased: boolean
  label: string
}

function indexingLabel(indexState: ConnectionIndexState | undefined): string {
  if (!indexState) return 'Preparing index...'
  const hasTableTotals = indexState.tablesTotal > 0
  const isFinalizingTables = indexState.phase === 'finalizing' && hasTableTotals
  if (isFinalizingTables) {
    return `Finalizing ${indexState.tablesDone}/${indexState.tablesTotal}`
  }
  const isEmbeddingTables = indexState.phase === 'embedding' && hasTableTotals
  if (isEmbeddingTables) {
    return `Indexing ${indexState.tablesDone}/${indexState.tablesTotal}`
  }
  const isReadingTables = indexState.phase === 'loading_schema' && indexState.tablesDone > 0
  if (isReadingTables) {
    return `Reading schema (${indexState.tablesDone} tables)...`
  }
  return 'Reading schema...'
}

function resolveIndexingProgress(indexState: ConnectionIndexState | undefined): IndexingProgress {
  const phase = indexState?.phase ?? null
  const hasTableTotals = (indexState?.tablesTotal ?? 0) > 0
  const isCountBasedPhase = phase === 'embedding' || phase === 'finalizing'
  return {
    phase: phase,
    isCountBased: isCountBasedPhase && hasTableTotals,
    label: indexingLabel(indexState),
  }
}

function hasVisibleTableGrid(tableData: TableDataTabState | null): tableData is TableDataTabState {
  if (tableData?.viewMode !== 'grid') return false
  return tableData.columns.length > 0 && tableData.error === null
}

function queryRowCountOf(result: SingleResultState) {
  return formatRowCountParts({
    viewRowCount: result.viewRowCount,
    totalRows: result.totalRows,
    isFiltered: result.filterModel.length > 0,
    truncated: result.truncated,
    autoLimitApplied: result.autoLimitApplied,
    appliedRowLimit: result.appliedRowLimit,
  })
}

function useActiveWorkspaceTab(connectionTabId: string | null) {
  const activeWorkspaceTabId = useWorkspaceStore((state) =>
    connectionTabId ? (state.activeTabByConnection[connectionTabId] ?? null) : null
  )
  const activeTabLocation: ActiveTabLocation = {
    connectionTabId: connectionTabId,
    tabId: activeWorkspaceTabId,
  }
  const activeWorkspaceTabType = useWorkspaceStore(
    (state) => findActiveTab(state.tabsByConnection, activeTabLocation)?.type ?? null
  )
  const activeTableDataTabId = useWorkspaceStore((state) =>
    tableDataTabShownIn(findActiveTab(state.tabsByConnection, activeTabLocation))
  )
  return {
    activeWorkspaceTabId: activeWorkspaceTabId,
    isQueryEditorTab: activeWorkspaceTabType === 'query-editor',
    activeTableDataTabId: activeTableDataTabId,
  }
}

function IndexBuildingIndicator({
  indexState,
  progress,
}: {
  indexState: ConnectionIndexState
  progress: IndexingProgress
}) {
  const phase = progress.phase ?? PREPARING_PHASE
  const accessibilityProps = progress.isCountBased
    ? {
        role: 'progressbar',
        'aria-valuenow': indexState.tablesDone,
        'aria-valuemin': 0,
        'aria-valuemax': indexState.tablesTotal,
        'aria-valuetext': `Schema indexing progress: ${indexState.tablesDone} of ${indexState.tablesTotal}`,
      }
    : { role: 'status', 'aria-label': progress.label }
  return (
    <div
      className={styles.indexingIndicator}
      data-testid="indexing-indicator"
      data-phase={phase}
      {...accessibilityProps}
    >
      <Database size={12} className={`${styles.indexingIcon} ${styles.indexingIconAnimated}`} />
      <span className={styles.indexingText} data-testid="indexing-text">
        {progress.label}
      </span>
    </div>
  )
}

function IndexFlashIndicator({
  flashType,
  fadingOut,
}: {
  flashType: FlashType
  fadingOut: boolean
}) {
  const display = INDEX_FLASH_DISPLAY[flashType]
  const Icon = display.icon
  const fadeClassName = fadingOut ? styles.indexingFadeOut : ''
  return (
    <div className={`${styles.indexingIndicator} ${fadeClassName}`} data-testid={display.testId}>
      <Icon size={12} weight="fill" className={`${styles.indexingIcon} ${display.toneClassName}`} />
      <span className={`${styles.indexingText} ${display.toneClassName}`}>{display.text}</span>
    </div>
  )
}

function QueryRunningInfo() {
  return (
    <div className={styles.queryRunningInfo} data-testid="query-running-info">
      <span className={styles.queryRunningSpinner} />
      <span className={styles.queryRunningText}>Running...</span>
    </div>
  )
}

function TableDataInfo({ visibleRows }: { visibleRows: number }) {
  return (
    <div className={styles.queryInfo} data-testid="table-data-info">
      <span className={styles.queryInfoItem} data-testid="table-data-rows">
        <span className={styles.queryInfoLabel}>Rows</span>{' '}
        <b className={styles.queryInfoTime}>{visibleRows}</b>
      </span>
    </div>
  )
}

type RowCountParts = ReturnType<typeof formatRowCountParts>

function rowCountText(rowCount: RowCountParts): string {
  if (!rowCount.segment) return String(rowCount.count)
  return `${rowCount.count} · ${rowCount.segment}`
}

function QueryInfo({ result, rowCount }: { result: SingleResultState; rowCount: RowCountParts }) {
  return (
    <div className={styles.queryInfo} data-testid="query-info">
      <span className={styles.queryInfoItem} data-testid="query-rows">
        <b className={`${styles.queryInfoTime} ${styles.queryRowCount}`}>
          {rowCount.segmentKind === 'truncated' && (
            <WarningCircle
              size={12}
              weight="fill"
              className={styles.queryRowCountWarning}
              aria-hidden="true"
              data-testid="query-rows-truncated-icon"
            />
          )}
          {rowCountText(rowCount)}
        </b>
      </span>
      <span className={styles.queryInfoItem} data-testid="query-time">
        <span className={styles.queryInfoLabel}>Exec</span>{' '}
        <b className={styles.queryInfoTime}>{result.executionTimeMs} ms</b>
      </span>
      <span className={styles.queryInfoItem} data-testid="query-total-time">
        <span className={styles.queryInfoLabel}>Total</span>{' '}
        <b className={styles.queryInfoTime}>{result.totalTimeMs} ms</b>
      </span>
    </div>
  )
}

function UpdateIndicator({ onOpenUpdates }: { onOpenUpdates: () => void }) {
  return (
    <Button
      variant="bare"
      className={styles.updateButton}
      data-testid="status-bar-update-indicator"
      aria-label="Update available, click to open update settings"
      onClick={onOpenUpdates}
    >
      <ArrowsClockwise size={12} weight="fill" className={styles.indexingIcon} />
      <span className={styles.updateButtonText}>Update available</span>
    </Button>
  )
}

function IdleStatusBar({ updateIndicator }: { updateIndicator: ReactNode }) {
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

interface QueryPane {
  isActive: boolean
  result: SingleResultState | null
  tabStatus: string | undefined
}

interface VisibleFlash {
  flashType: FlashType
  fadingOut: boolean
}

interface QueryInfoState {
  result: SingleResultState
  rowCount: RowCountParts
}

interface StatusActivity {
  buildingIndex: ConnectionIndexState | null
  flash: VisibleFlash | null
  showRunningInfo: boolean
  tableRows: number | null
  queryInfo: QueryInfoState | null
}

interface StatusActivityInputs {
  indexState: ConnectionIndexState | undefined
  flash: { flashType: FlashType | null; fadingOut: boolean }
  queryPane: QueryPane
  tableData: TableDataTabState | null
}

function buildingIndexOf(indexState: ConnectionIndexState | undefined) {
  if (indexState?.status !== 'building') return null
  return indexState
}

function resolveVisibleFlash(
  isBuilding: boolean,
  flash: StatusActivityInputs['flash']
): VisibleFlash | null {
  if (isBuilding) return null
  if (!flash.flashType) return null
  return { flashType: flash.flashType, fadingOut: flash.fadingOut }
}

function visibleTableRows(tableData: TableDataTabState | null): number | null {
  if (!hasVisibleTableGrid(tableData)) return null
  return tableData.rows.length
}

// Query info follows the active result's status, not the tab-level status, which may be
// 'success' even for partial-error multi-results.
function resolveQueryInfo(queryPane: QueryPane): QueryInfoState | null {
  if (!queryPane.isActive) return null
  const result = queryPane.result
  if (result?.resultStatus !== 'success') return null
  return { result: result, rowCount: queryRowCountOf(result) }
}

function resolveStatusActivity(inputs: StatusActivityInputs): StatusActivity {
  const buildingIndex = buildingIndexOf(inputs.indexState)
  return {
    buildingIndex: buildingIndex,
    flash: resolveVisibleFlash(buildingIndex !== null, inputs.flash),
    showRunningInfo: inputs.queryPane.isActive && inputs.queryPane.tabStatus === 'running',
    tableRows: visibleTableRows(inputs.tableData),
    queryInfo: resolveQueryInfo(inputs.queryPane),
  }
}

function hasAnyActivity(activity: StatusActivity): boolean {
  return [
    activity.buildingIndex !== null,
    activity.flash !== null,
    activity.showRunningInfo,
    activity.queryInfo !== null,
    activity.tableRows !== null,
  ].some(Boolean)
}

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

  // Schema index status for the active connection session
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

  const updateIndicator =
    updateStatus === 'available' ? (
      <UpdateIndicator onOpenUpdates={() => openSettingsDialog('updates')} />
    ) : null

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
