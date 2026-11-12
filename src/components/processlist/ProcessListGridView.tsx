import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useProcessListStore } from '../../stores/processlist-store'
import { filterProcessListRows } from '../../lib/processlist-filter'
import { CanvasBaseGridView } from '../shared/glide/CanvasBaseGridView'
import { InfoCellPopover } from './InfoCellPopover'
import type { ProcessRow } from '../../lib/processlist-commands'
import type { GridColumnDescriptor } from '../../types/shared-data-view'
import type { GridColumn, GridHandle } from '../shared/glide/glide-grid-types'
import styles from './ProcessListGridView.module.css'
import { isPlaywrightBuild } from '../../lib/tauri-env'

const FALLBACK_HEADER_HEIGHT_PX = 32
const FALLBACK_ROW_HEIGHT_PX = 28
const FALLBACK_INFO_COLUMN_WIDTH_PX = 260
const FALLBACK_INFO_ANCHOR = { x: 320, y: 200, width: FALLBACK_INFO_COLUMN_WIDTH_PX, height: 36 }

type GridRow = ProcessRow & Record<string, unknown>
type ProcessListPlaywrightApi = {
  openInfoPopover?: (connectionId: string, rowIndex: number) => boolean
}

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

const SORT_DIRECTION_SIGN: Record<SortDirection, number> = { ASC: 1, DESC: -1 }

function compareProcessValues(leftValue: unknown, rightValue: unknown): number {
  if (leftValue == null && rightValue == null) return 0
  if (leftValue == null) return -1
  if (rightValue == null) return 1
  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
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
  return parsedWidths.filter((width): width is number => typeof width === 'number' && width > 0)
}

function cssPixelsOr(rootStyles: CSSStyleDeclaration, property: string, fallback: number): number {
  return parseFloat(rootStyles.getPropertyValue(property)) || fallback
}

function gridRowMetrics() {
  const rootStyles = getComputedStyle(document.documentElement)
  return {
    headerHeight: cssPixelsOr(rootStyles, '--grid-header-height', FALLBACK_HEADER_HEIGHT_PX),
    rowHeight: cssPixelsOr(rootStyles, '--grid-row-height', FALLBACK_ROW_HEIGHT_PX),
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

export function ProcessListGridView({ connectionId, isActive = true }: ProcessListGridViewProps) {
  const gridRef = useRef<GridHandle | null>(null)
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

  const [popoverSql, setPopoverSql] = useState<string | null>(null)
  const [popoverAnchorRect, setPopoverAnchorRect] = useState<DOMRect | null>(null)

  const visibleRows = useMemo(
    () => filterProcessListRows(rows, excludeIdleConnections),
    [rows, excludeIdleConnections]
  )

  // Sort rows directly without intermediate mapping — ProcessRow already matches grid shape
  const gridRows: GridRow[] = useMemo(() => {
    const sortedRows = [...visibleRows] as GridRow[]
    if (sortColumn) {
      const columnKey = sortColumn.columnKey as keyof ProcessRow
      const directionSign = SORT_DIRECTION_SIGN[sortColumn.direction]
      sortedRows.sort(
        (left, right) => directionSign * compareProcessValues(left[columnKey], right[columnKey])
      )
    }
    return sortedRows.map((row) => ({
      ...row,
      [PROCESSLIST_SELECTED_COLUMN_KEY]: selectedIds.has(row.id),
    }))
  }, [visibleRows, sortColumn, selectedIds])

  const handleSortChange = useCallback(
    (column: string | null, direction: SortDirection | null) => {
      const nextSort = column && direction ? { columnKey: column, direction: direction } : null
      setSortColumn(connectionId, nextSort)
    },
    [connectionId, setSortColumn]
  )

  const handleClosePopover = useCallback(() => {
    setPopoverSql(null)
    setPopoverAnchorRect(null)
  }, [])

  useEffect(() => {
    if (isActive) return
    queueMicrotask(handleClosePopover)
  }, [handleClosePopover, isActive])

  const computeInfoAnchorRect = useCallback((rowIndex: number): DOMRect | null => {
    const host = gridRef.current?.element
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
  }, [])

  const openInfoPopoverForRow = useCallback(
    (rowIndex: number): boolean => {
      const row = gridRows[rowIndex]
      const info = row?.info
      if (typeof info !== 'string' || info.length === 0) return false
      setPopoverSql(info)
      setPopoverAnchorRect(computeInfoAnchorRect(rowIndex) ?? fallbackInfoAnchorRect())
      return true
    },
    [computeInfoAnchorRect, gridRows]
  )

  const handleInfoCellClick = useCallback((row: Record<string, unknown>, anchorRect: DOMRect) => {
    const info = row.info
    if (typeof info !== 'string' || info.length === 0) return
    setPopoverSql(info)
    setPopoverAnchorRect(anchorRect)
  }, [])

  useEffect(() => {
    if (!isPlaywrightBuild()) return

    const playwrightWindow = window as typeof window & {
      __processListTestApi__?: ProcessListPlaywrightApi
    }
    const previousApi = playwrightWindow.__processListTestApi__

    playwrightWindow.__processListTestApi__ = {
      ...previousApi,
      openInfoPopover: (targetConnectionId: string, rowIndex: number) => {
        if (targetConnectionId !== connectionId) return false
        return openInfoPopoverForRow(rowIndex)
      },
    }

    return () => {
      if (playwrightWindow.__processListTestApi__?.openInfoPopover) {
        delete playwrightWindow.__processListTestApi__.openInfoPopover
      }
      if (
        playwrightWindow.__processListTestApi__ &&
        Object.keys(playwrightWindow.__processListTestApi__).length === 0
      ) {
        delete playwrightWindow.__processListTestApi__
      }
    }
  }, [connectionId, openInfoPopoverForRow])

  const handleCellValueChange = useCallback(
    (rowIndex: number, columnKey: string, value: unknown) => {
      if (columnKey !== PROCESSLIST_SELECTED_COLUMN_KEY) return
      const row = gridRows[rowIndex]
      if (!row) return
      setSelectedIds(connectionId, withSelection(selectedIds, row.id, value === true))
    },
    [connectionId, gridRows, selectedIds, setSelectedIds]
  )

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
        onInfoCellClick={handleInfoCellClick}
        showInfoColumn={true}
        applyReadOnlyCellStyles={false}
        testId="processlist-grid-view"
        isActive={isActive}
      />
      <InfoCellPopover
        sql={popoverSql}
        anchorRect={popoverAnchorRect}
        onClose={handleClosePopover}
      />
    </div>
  )
}
