import { useEffect, useRef, useState } from 'react'
import { CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useQueryStore, type SingleResultState } from '../../../stores/query-store'
import type { ConnectionIndexState } from '../../../stores/schema-index-store'
import { formatRowCountParts } from '../../../lib/format-row-count'
import type { TableDataTabState, WorkspaceTab } from '../../../types/schema'
import {
  resolveResultPendingWork,
  resolveTablePendingWork,
  type PendingWork,
} from './pending-work-model'

export const READY_FLASH_DURATION_MS = 2000
export const STATUS_FLASH_DURATION_MS = 3000
export const FLASH_FADE_OUT_MS = 500
export const PREPARING_PHASE = 'preparing'

export const statusLabel: Record<string, string> = {
  connected: 'Connected',
  reconnecting: 'Reconnecting...',
  disconnected: 'Disconnected',
}

export type FlashType = 'ready' | 'error'

export const FLASH_DURATION_MS: Record<FlashType, number> = {
  ready: READY_FLASH_DURATION_MS,
  error: STATUS_FLASH_DURATION_MS,
}

export const INDEX_FLASH_DISPLAY: Record<
  FlashType,
  { testId: string; icon: typeof CheckCircle; toneClassName: string; text: string }
> = {
  ready: {
    testId: 'indexing-ready',
    icon: CheckCircle,
    toneClassName: 'text-light-tertiary dark:text-dark-tertiary',
    text: 'Index ready',
  },
  error: {
    testId: 'indexing-error',
    icon: WarningCircle,
    toneClassName: 'text-light-error dark:text-dark-error',
    text: 'Index error',
  },
}

export type ScheduledFlash = {
  frame: number | undefined
  flashTimer: ReturnType<typeof setTimeout> | undefined
  fadeTimer: ReturnType<typeof setTimeout> | undefined
}

export function isFlashStatus(status: string | undefined): status is FlashType {
  return status === 'ready' || status === 'error'
}

export function isFlashTransition(
  previousStatus: string | undefined,
  status: string | undefined
): status is FlashType {
  if (!isFlashStatus(status)) return false
  return previousStatus !== undefined && previousStatus !== status
}

export function cancelScheduledFlash(scheduled: ScheduledFlash): void {
  if (scheduled.frame !== undefined) cancelAnimationFrame(scheduled.frame)
  if (scheduled.flashTimer !== undefined) clearTimeout(scheduled.flashTimer)
  if (scheduled.fadeTimer !== undefined) clearTimeout(scheduled.fadeTimer)
}

export function useIndexFlash(indexStatus: string | undefined) {
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

export function findTab(tabs: WorkspaceTab[] | undefined, tabId: string): WorkspaceTab | null {
  return tabs?.find((tab) => tab.id === tabId) ?? null
}

export interface ActiveTabLocation {
  connectionTabId: string | null
  tabId: string | null
}

export function findActiveTab(
  tabsByConnection: Record<string, WorkspaceTab[]>,
  location: ActiveTabLocation
): WorkspaceTab | null {
  if (!location.connectionTabId) return null
  if (!location.tabId) return null
  return findTab(tabsByConnection[location.connectionTabId], location.tabId)
}

export function tableDataTabShownIn(activeTab: WorkspaceTab | null): string | null {
  if (!activeTab) return null
  if (activeTab.type === 'table-data') return activeTab.id
  if (activeTab.type !== 'query-editor') return null
  const bottomPanelItem = useQueryStore.getState().tabs[activeTab.id]?.activeBottomPanelItem
  if (bottomPanelItem?.type !== 'table-data') return null
  return bottomPanelItem.tabId
}

export interface IndexingProgress {
  phase: ConnectionIndexState['phase']
  isCountBased: boolean
  label: string
}

export function indexingLabel(indexState: ConnectionIndexState | undefined): string {
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

export function resolveIndexingProgress(
  indexState: ConnectionIndexState | undefined
): IndexingProgress {
  const phase = indexState?.phase ?? null
  const hasTableTotals = (indexState?.tablesTotal ?? 0) > 0
  const isCountBasedPhase = phase === 'embedding' || phase === 'finalizing'
  return {
    phase: phase,
    isCountBased: isCountBasedPhase && hasTableTotals,
    label: indexingLabel(indexState),
  }
}

export function hasLoadedTableData(
  tableData: TableDataTabState | null
): tableData is TableDataTabState {
  if (!tableData) return false
  return tableData.columns.length > 0 && tableData.error === null
}

export function queryRowCountOf(result: SingleResultState) {
  return formatRowCountParts({
    viewRowCount: result.viewRowCount,
    totalRows: result.totalRows,
    isFiltered: result.filterModel.length > 0,
    truncated: result.truncated,
    autoLimitApplied: result.autoLimitApplied,
    appliedRowLimit: result.appliedRowLimit,
  })
}

export function useActiveWorkspaceTab(connectionTabId: string | null) {
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

export interface QueryPane {
  isActive: boolean
  result: SingleResultState | null
  tabStatus: string | undefined
}

export interface VisibleFlash {
  flashType: FlashType
  fadingOut: boolean
}

export interface QueryInfoState {
  result: SingleResultState
  rowCount: RowCountParts
}

export interface TableDataInfoState {
  visibleRows: number
  executionTimeMs: number | null
}

export interface StatusActivity {
  buildingIndex: ConnectionIndexState | null
  flash: VisibleFlash | null
  showRunningInfo: boolean
  pendingWork: PendingWork | null
  tableInfo: TableDataInfoState | null
  queryInfo: QueryInfoState | null
}

export interface StatusActivityInputs {
  indexState: ConnectionIndexState | undefined
  flash: { flashType: FlashType | null; fadingOut: boolean }
  queryPane: QueryPane
  tableData: TableDataTabState | null
}

export function buildingIndexOf(indexState: ConnectionIndexState | undefined) {
  if (indexState?.status !== 'building') return null
  return indexState
}

export function resolveVisibleFlash(
  isBuilding: boolean,
  flash: StatusActivityInputs['flash']
): VisibleFlash | null {
  if (isBuilding) return null
  if (!flash.flashType) return null
  return { flashType: flash.flashType, fadingOut: flash.fadingOut }
}

function positiveOrNull(value: number): number | null {
  if (value > 0) return value
  return null
}

export function resolveTableDataInfo(
  tableData: TableDataTabState | null
): TableDataInfoState | null {
  if (!hasLoadedTableData(tableData)) return null
  return {
    visibleRows: tableData.rows.length,
    executionTimeMs: positiveOrNull(tableData.executionTimeMs),
  }
}

export function resolvePendingWork(inputs: StatusActivityInputs): PendingWork | null {
  if (inputs.queryPane.isActive) return resolveResultPendingWork(inputs.queryPane.result)
  return resolveTablePendingWork(inputs.tableData)
}

export function resolveQueryInfo(queryPane: QueryPane): QueryInfoState | null {
  if (!queryPane.isActive) return null
  const result = queryPane.result
  if (result?.resultStatus !== 'success') return null
  return { result: result, rowCount: queryRowCountOf(result) }
}

export function resolveStatusActivity(inputs: StatusActivityInputs): StatusActivity {
  const buildingIndex = buildingIndexOf(inputs.indexState)
  return {
    buildingIndex: buildingIndex,
    flash: resolveVisibleFlash(buildingIndex !== null, inputs.flash),
    showRunningInfo: inputs.queryPane.isActive && inputs.queryPane.tabStatus === 'running',
    pendingWork: resolvePendingWork(inputs),
    tableInfo: resolveTableDataInfo(inputs.tableData),
    queryInfo: resolveQueryInfo(inputs.queryPane),
  }
}

export type RowCountParts = ReturnType<typeof formatRowCountParts>

export function rowCountText(rowCount: RowCountParts): string {
  if (!rowCount.segment) return String(rowCount.count)
  return `${rowCount.count} · ${rowCount.segment}`
}
