import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useProcessListStore } from '../../stores/processlist-store'
import { filterProcessListRows } from '../../lib/processlist-filter'
import { CanvasBaseGridView } from '../shared/glide/CanvasBaseGridView'
import { InfoCellPopover } from './InfoCellPopover'
import type { ProcessRow } from '../../lib/processlist-commands'
import type { GridColumnDescriptor } from '../../types/shared-data-view'
import type { GridColumn, GridHandle } from '../shared/glide/glide-grid-types'
import styles from './ProcessListGridView.module.css'

type GridRow = ProcessRow & Record<string, unknown>
type ProcessListPlaywrightApi = {
  openInfoPopover?: (connectionId: string, rowIndex: number) => boolean
}

const EMPTY_SET = new Set<number>()
const EMPTY_PROCESS_ROWS: ProcessRow[] = []
const IS_PLAYWRIGHT = import.meta.env.VITE_PLAYWRIGHT === 'true'
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

export interface ProcessListGridViewProps {
  connectionId: string
  isActive?: boolean
}

export function ProcessListGridView({ connectionId, isActive = true }: ProcessListGridViewProps) {
  const gridRef = useRef<GridHandle | null>(null)
  const rows = useProcessListStore((s) => s.rowsByConnection[connectionId] ?? EMPTY_PROCESS_ROWS)
  const selectedIds = useProcessListStore(
    (s) => s.selectedIdsByConnection[connectionId] ?? EMPTY_SET
  )
  const excludeIdleConnections = useProcessListStore(
    (s) => s.excludeIdleConnectionsByConnection[connectionId] ?? true
  )
  const sortColumn = useProcessListStore((s) => s.sortColumnByConnection[connectionId] ?? null)
  const setSortColumn = useProcessListStore((s) => s.setSortColumn)
  const setSelectedIds = useProcessListStore((s) => s.setSelectedIds)

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
      const { columnKey, direction } = sortColumn
      sortedRows.sort((a, b) => {
        const aVal = a[columnKey as keyof ProcessRow]
        const bVal = b[columnKey as keyof ProcessRow]
        if (aVal == null && bVal == null) return 0
        if (aVal == null) return direction === 'ASC' ? -1 : 1
        if (bVal == null) return direction === 'ASC' ? 1 : -1
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return direction === 'ASC' ? aVal - bVal : bVal - aVal
        }
        const cmp = String(aVal).localeCompare(String(bVal))
        return direction === 'ASC' ? cmp : -cmp
      })
    }
    return sortedRows.map((row) => ({
      ...row,
      [PROCESSLIST_SELECTED_COLUMN_KEY]: selectedIds.has(row.id),
    }))
  }, [visibleRows, sortColumn, selectedIds])

  const handleSortChange = useCallback(
    (column: string | null, direction: 'ASC' | 'DESC' | null) => {
      if (column && direction) {
        setSortColumn(connectionId, { columnKey: column, direction })
      } else {
        setSortColumn(connectionId, null)
      }
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

    const parsedWidths: unknown = JSON.parse(host.dataset.glideColumnWidth ?? '[]')
    const columnWidths = Array.isArray(parsedWidths)
      ? parsedWidths.filter((width): width is number => typeof width === 'number' && width > 0)
      : []
    const infoColumnIndex = columnWidths.length - 1
    if (infoColumnIndex < 0) return null

    const scroller = host.querySelector<HTMLElement>('.dvn-scroller') ?? host
    const rowMarkerWidth = parseFloat(host.dataset.rowMarkerWidth ?? '0') || 0
    const hostRect = host.getBoundingClientRect()
    const rootStyles = getComputedStyle(document.documentElement)
    const headerHeight = parseFloat(rootStyles.getPropertyValue('--grid-header-height')) || 32
    const rowHeight = parseFloat(rootStyles.getPropertyValue('--grid-row-height')) || 32
    const columnStart =
      rowMarkerWidth +
      columnWidths.slice(0, infoColumnIndex).reduce((sum, next) => sum + next, 0) -
      scroller.scrollLeft

    return new DOMRect(
      hostRect.x + columnStart,
      hostRect.y + headerHeight + rowIndex * rowHeight - scroller.scrollTop,
      columnWidths[infoColumnIndex] ?? 260,
      rowHeight
    )
  }, [])

  const openInfoPopoverForRow = useCallback(
    (rowIndex: number): boolean => {
      const row = gridRows[rowIndex]
      const info = row?.info
      if (typeof info !== 'string' || info.length === 0) return false
      setPopoverSql(info)
      setPopoverAnchorRect(computeInfoAnchorRect(rowIndex) ?? new DOMRect(320, 200, 260, 36))
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
    if (!IS_PLAYWRIGHT) return

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
    (rowIdx: number, columnKey: string, value: unknown) => {
      if (columnKey !== PROCESSLIST_SELECTED_COLUMN_KEY) return
      const row = gridRows[rowIdx]
      if (!row) return
      const nextSelectedIds = new Set(selectedIds)
      if (value === true) {
        nextSelectedIds.add(row.id)
      } else {
        nextSelectedIds.delete(row.id)
      }
      setSelectedIds(connectionId, nextSelectedIds)
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
