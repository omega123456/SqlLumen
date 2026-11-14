import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useProcessListStore } from '../../stores/processlist-store'
import { filterProcessListRows } from '../../lib/processlist-filter'
import { CanvasBaseGridView } from '../shared/glide/CanvasBaseGridView'
import { InfoCellPopover } from './InfoCellPopover'
import type { ProcessRow } from '../../lib/processlist-commands'
import type { GridColumnDescriptor } from '../../types/shared-data-view'
import type { GridColumn, GridHandle } from '../shared/glide/glide-grid-types'
import styles from './ProcessListGridView.module.css'
import { isPlaywrightBuild } from '../../lib/tauri-env'
import { readPixelToken } from '../../lib/theme-tokens'
import { isNonEmptyString, isNullish, isPositiveNumber } from '../../lib/value-checks'

const FALLBACK_HEADER_HEIGHT_PX = 32
const FALLBACK_ROW_HEIGHT_PX = 28
const FALLBACK_INFO_COLUMN_WIDTH_PX = 260
const FALLBACK_INFO_ANCHOR = { x: 320, y: 200, width: FALLBACK_INFO_COLUMN_WIDTH_PX, height: 36 }

type GridRow = ProcessRow & Record<string, unknown>
const EMPTY_SET = new Set<number>()
const EMPTY_PROCESS_ROWS: ProcessRow[] = []
const PROCESSLIST_SELECTED_COLUMN_KEY = '__processlistSelected'

const PROCESSLIST_SELECTION_COLUMN: GridColumn<Record<string, unknown>> = {
  key: PROCESSLIST_SELECTED_COLUMN_KEY,
  name: '',
  width: 34,
  resizable: false,
  sortable: false,
  cellKind: 'checkbox',
}

const PROCESSLIST_COLUMNS: GridColumnDescriptor[] = [
  {
    key: 'id',
    displayName: 'Id',
    dataType: 'BIGINT',
    editable: false,
    isBinary: false,
    isNullable: false,
    isPrimaryKey: false,
    isUniqueKey: false,
  },
  {
    key: 'user',
    displayName: 'User',
    dataType: 'VARCHAR',
    editable: false,
    isBinary: false,
    isNullable: false,
    isPrimaryKey: false,
    isUniqueKey: false,
  },
  {
    key: 'host',
    displayName: 'Host',
    dataType: 'VARCHAR',
    editable: false,
    isBinary: false,
    isNullable: false,
    isPrimaryKey: false,
    isUniqueKey: false,
  },
  {
    key: 'db',
    displayName: 'db',
    dataType: 'VARCHAR',
    editable: false,
    isBinary: false,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
  },
  {
    key: 'command',
    displayName: 'Command',
    dataType: 'VARCHAR',
    editable: false,
    isBinary: false,
    isNullable: false,
    isPrimaryKey: false,
    isUniqueKey: false,
  },
  {
    key: 'time',
    displayName: 'Time',
    dataType: 'BIGINT',
    editable: false,
    isBinary: false,
    isNullable: false,
    isPrimaryKey: false,
    isUniqueKey: false,
  },
  {
    key: 'state',
    displayName: 'State',
    dataType: 'VARCHAR',
    editable: false,
    isBinary: false,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
  },
]

type SortDirection = 'ASC' | 'DESC'

interface ProcessSortColumn {
  columnKey: string
  direction: SortDirection
}

const SORT_DIRECTION_SIGN: Record<SortDirection, number> = { ASC: 1, DESC: -1 }

function compareProcessValues(leftValue: unknown, rightValue: unknown): number {
  const isLeftMissing = isNullish(leftValue)
  const isRightMissing = isNullish(rightValue)
  if (isLeftMissing && isRightMissing) return 0
  if (isLeftMissing) return -1
  if (isRightMissing) return 1
  const areBothNumbers = typeof leftValue === 'number' && typeof rightValue === 'number'
  if (areBothNumbers) {
    return leftValue - rightValue
  }
  return String(leftValue).localeCompare(String(rightValue))
}

function withSelection(selectedIds: Set<number>, id: number, isSelected: boolean): Set<number> {
  const nextSelectedIds = new Set(selectedIds)
  if (isSelected) {
    nextSelectedIds.add(id)
    return nextSelectedIds
  }
  nextSelectedIds.delete(id)
  return nextSelectedIds
}

function parseColumnWidths(host: HTMLElement): number[] {
  const parsedWidths: unknown = JSON.parse(host.dataset.glideColumnWidth ?? '[]')
  if (!Array.isArray(parsedWidths)) return []
  return parsedWidths.filter(isPositiveNumber)
}

function gridRowMetrics() {
  return {
    headerHeight: readPixelToken('--spacing-grid-header', FALLBACK_HEADER_HEIGHT_PX),
    rowHeight: readPixelToken('--spacing-grid-row', FALLBACK_ROW_HEIGHT_PX),
  }
}

function fallbackInfoAnchorRect(): DOMRect {
  return new DOMRect(
    FALLBACK_INFO_ANCHOR.x,
    FALLBACK_INFO_ANCHOR.y,
    FALLBACK_INFO_ANCHOR.width,
    FALLBACK_INFO_ANCHOR.height
  )
}

export interface ProcessListGridViewProps {
  connectionId: string
  isActive?: boolean
}

function sortedProcessRows(visibleRows: ProcessRow[], sortColumn: ProcessSortColumn | null) {
  const sortedRows = [...visibleRows] as GridRow[]
  if (!sortColumn) return sortedRows
  const columnKey = sortColumn.columnKey as keyof ProcessRow
  const directionSign = SORT_DIRECTION_SIGN[sortColumn.direction]
  return sortedRows.sort(
    (left, right) => directionSign * compareProcessValues(left[columnKey], right[columnKey])
  )
}

function useProcessGridRows(connectionId: string) {
  const rows = useProcessListStore(
    (state) => state.rowsByConnection[connectionId] ?? EMPTY_PROCESS_ROWS
  )
  const selectedIds = useProcessListStore(
    (state) => state.selectedIdsByConnection[connectionId] ?? EMPTY_SET
  )
  const excludeIdleConnections = useProcessListStore(
    (state) => state.excludeIdleConnectionsByConnection[connectionId] ?? true
  )
  const sortColumn = useProcessListStore(
    (state) => state.sortColumnByConnection[connectionId] ?? null
  )
  const setSortColumn = useProcessListStore((state) => state.setSortColumn)
  const setSelectedIds = useProcessListStore((state) => state.setSelectedIds)

  const visibleRows = useMemo(
    () => filterProcessListRows(rows, excludeIdleConnections),
    [rows, excludeIdleConnections]
  )

  const gridRows: GridRow[] = useMemo(
    () =>
      sortedProcessRows(visibleRows, sortColumn).map((row) => ({
        ...row,
        [PROCESSLIST_SELECTED_COLUMN_KEY]: selectedIds.has(row.id),
      })),
    [visibleRows, sortColumn, selectedIds]
  )

  const handleSortChange = useCallback(
    (column: string | null, direction: SortDirection | null) => {
      const nextSort = column && direction ? { columnKey: column, direction: direction } : null
      setSortColumn(connectionId, nextSort)
    },
    [connectionId, setSortColumn]
  )

  const handleCellValueChange = useCallback(
    (rowIndex: number, columnKey: string, value: unknown) => {
      if (columnKey !== PROCESSLIST_SELECTED_COLUMN_KEY) return
      const row = gridRows[rowIndex]
      if (!row) return
      setSelectedIds(connectionId, withSelection(selectedIds, row.id, value === true))
    },
    [connectionId, gridRows, selectedIds, setSelectedIds]
  )

  return { gridRows, sortColumn, handleSortChange, handleCellValueChange }
}

function computeInfoAnchorRect(
  host: HTMLElement | null | undefined,
  rowIndex: number
): DOMRect | null {
  if (!host) return null

  const columnWidths = parseColumnWidths(host)
  const infoColumnIndex = columnWidths.length - 1
  if (infoColumnIndex < 0) return null

  const scroller = host.querySelector<HTMLElement>('.dvn-scroller') ?? host
  const rowMarkerWidth = parseFloat(host.dataset.rowMarkerWidth ?? '0') || 0
  const hostRect = host.getBoundingClientRect()
  const { headerHeight, rowHeight } = gridRowMetrics()
  const columnStart =
    rowMarkerWidth +
    columnWidths.slice(0, infoColumnIndex).reduce((sum, next) => sum + next, 0) -
    scroller.scrollLeft

  return new DOMRect(
    hostRect.x + columnStart,
    hostRect.y + headerHeight + rowIndex * rowHeight - scroller.scrollTop,
    columnWidths[infoColumnIndex] ?? FALLBACK_INFO_COLUMN_WIDTH_PX,
    rowHeight
  )
}

function removeInfoPopoverTestApi(): void {
  if (window.__processListTestApi__?.openInfoPopover) {
    delete window.__processListTestApi__.openInfoPopover
  }
  const remainingTestApi = window.__processListTestApi__
  if (!remainingTestApi) return
  if (Object.keys(remainingTestApi).length > 0) return
  delete window.__processListTestApi__
}

function useInfoPopoverTestApi(
  connectionId: string,
  openInfoPopoverForRow: (rowIndex: number) => boolean
): void {
  useEffect(() => {
    if (!isPlaywrightBuild()) return

    const previousApi = window.__processListTestApi__

    window.__processListTestApi__ = {
      ...previousApi,
      openInfoPopover: (targetConnectionId: string, rowIndex: number) => {
        if (targetConnectionId !== connectionId) return false
        return openInfoPopoverForRow(rowIndex)
      },
    }

    return removeInfoPopoverTestApi
  }, [connectionId, openInfoPopoverForRow])
}

interface InfoPopoverInput {
  gridRef: RefObject<GridHandle | null>
  gridRows: GridRow[]
  isActive: boolean
}

interface InfoPopoverTarget {
  sql: string
  anchorRect: DOMRect
}

function useInfoPopover({ gridRef, gridRows, isActive }: InfoPopoverInput) {
  const [popoverTarget, setPopoverTarget] = useState<InfoPopoverTarget | null>(null)

  const handleClosePopover = useCallback(() => {
    setPopoverTarget(null)
  }, [])

  useEffect(() => {
    if (isActive) return
    queueMicrotask(handleClosePopover)
  }, [handleClosePopover, isActive])

  const openInfoPopoverForRow = useCallback(
    (rowIndex: number): boolean => {
      const row = gridRows[rowIndex]
      const info = row?.info
      if (!isNonEmptyString(info)) return false
      const anchorRect =
        computeInfoAnchorRect(gridRef.current?.element, rowIndex) ?? fallbackInfoAnchorRect()
      setPopoverTarget({ sql: info, anchorRect: anchorRect })
      return true
    },
    [gridRef, gridRows]
  )

  const handleInfoCellClick = useCallback((row: Record<string, unknown>, anchorRect: DOMRect) => {
    const info = row.info
    if (!isNonEmptyString(info)) return
    setPopoverTarget({ sql: info, anchorRect: anchorRect })
  }, [])

  return { popoverTarget, handleClosePopover, openInfoPopoverForRow, handleInfoCellClick }
}

export function ProcessListGridView({ connectionId, isActive = true }: ProcessListGridViewProps) {
  const gridRef = useRef<GridHandle | null>(null)
  const { gridRows, sortColumn, handleSortChange, handleCellValueChange } =
    useProcessGridRows(connectionId)
  const infoPopover = useInfoPopover({ gridRef: gridRef, gridRows: gridRows, isActive: isActive })
  useInfoPopoverTestApi(connectionId, infoPopover.openInfoPopoverForRow)

  return (
    <div className={styles.container}>
      <CanvasBaseGridView
        ref={gridRef}
        rows={gridRows}
        columns={PROCESSLIST_COLUMNS}
        editState={null}
        sortColumn={sortColumn?.columnKey ?? null}
        sortDirection={sortColumn?.direction ?? null}
        onSortChange={handleSortChange}
        rowMarkers="none"
        prefixColumns={[PROCESSLIST_SELECTION_COLUMN]}
        onCellValueChange={handleCellValueChange}
        onInfoCellClick={infoPopover.handleInfoCellClick}
        showInfoColumn={true}
        applyReadOnlyCellStyles={false}
        testId="processlist-grid-view"
        isActive={isActive}
      />
      <InfoCellPopover
        sql={infoPopover.popoverTarget?.sql ?? null}
        anchorRect={infoPopover.popoverTarget?.anchorRect ?? null}
        onClose={infoPopover.handleClosePopover}
      />
    </div>
  )
}
