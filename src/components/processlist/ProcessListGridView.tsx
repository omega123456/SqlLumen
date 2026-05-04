import { useCallback, useMemo, useState } from 'react'
import { useProcessListStore } from '../../stores/processlist-store'
import { filterProcessListRows } from '../../lib/processlist-filter'
import { Checkbox } from '../common/Checkbox'
import { BaseGridView } from '../shared/BaseGridView'
import { InfoCellPopover } from './InfoCellPopover'
import type { ProcessRow } from '../../lib/processlist-commands'
import type { GridColumnDescriptor } from '../../types/shared-data-view'
import type { Column } from '../shared/DataGrid'
import styles from './ProcessListGridView.module.css'

type GridRow = ProcessRow & Record<string, unknown>

const EMPTY_SET = new Set<number>()
const EMPTY_PROCESS_ROWS: ProcessRow[] = []

/** Checkbox cell that subscribes to the store directly to avoid recreating prefixColumns. */
function ProcessCheckboxCell({
  connectionId,
  processId,
}: {
  connectionId: string
  processId: number
}) {
  const checked = useProcessListStore((s) =>
    (s.selectedIdsByConnection[connectionId] ?? EMPTY_SET).has(processId)
  )
  const toggleSelectedId = useProcessListStore((s) => s.toggleSelectedId)
  return (
    <div className={styles.checkboxWrapper} onClick={(e) => e.stopPropagation()}>
      <Checkbox
        checked={checked}
        onChange={() => toggleSelectedId(connectionId, processId)}
        aria-label={`Select process ${processId}`}
      />
    </div>
  )
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
}

export function ProcessListGridView({ connectionId }: ProcessListGridViewProps) {
  const rows = useProcessListStore((s) => s.rowsByConnection[connectionId] ?? EMPTY_PROCESS_ROWS)
  const selectedIds = useProcessListStore(
    (s) => s.selectedIdsByConnection[connectionId] ?? EMPTY_SET
  )
  const excludeIdleConnections = useProcessListStore(
    (s) => s.excludeIdleConnectionsByConnection[connectionId] ?? true
  )
  const sortColumn = useProcessListStore((s) => s.sortColumnByConnection[connectionId] ?? null)
  const setSortColumn = useProcessListStore((s) => s.setSortColumn)

  const [popoverSql, setPopoverSql] = useState<string | null>(null)
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null)

  const visibleRows = useMemo(
    () => filterProcessListRows(rows, excludeIdleConnections),
    [rows, excludeIdleConnections]
  )

  // Sort rows directly without intermediate mapping — ProcessRow already matches grid shape
  const gridRows: GridRow[] = useMemo(() => {
    if (!sortColumn) return visibleRows as GridRow[]

    const { columnKey, direction } = sortColumn
    return ([...visibleRows] as GridRow[]).sort((a, b) => {
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
  }, [visibleRows, sortColumn])

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
    setPopoverAnchor(null)
  }, [])

  const handleInfoCellClick = useCallback((e: React.MouseEvent<HTMLSpanElement>, info: string) => {
    e.stopPropagation()
    setPopoverSql(info)
    setPopoverAnchor(e.currentTarget)
  }, [])

  const prefixColumns = useMemo<Column<Record<string, unknown>>[]>(
    () => [
      {
        key: '__select__',
        name: '',
        width: 48,
        minWidth: 48,
        maxWidth: 48,
        resizable: false,
        sortable: false,
        cellClass: 'rdg-checkbox-cell',
        renderCell: ({ row }: { row: Record<string, unknown> }) => {
          return <ProcessCheckboxCell connectionId={connectionId} processId={row.id as number} />
        },
      },
    ],
    [connectionId]
  )

  const suffixColumns = useMemo<Column<Record<string, unknown>>[]>(
    () => [
      {
        key: 'info',
        name: 'Info',
        resizable: true,
        sortable: true,
        renderCell: ({ row }: { row: Record<string, unknown> }) => {
          const info = row.info as string | null
          if (!info) return null
          return (
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <span
              role="button"
              tabIndex={0}
              className={styles.infoCell}
              onClick={(e) => handleInfoCellClick(e, info)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setPopoverSql(info)
                  setPopoverAnchor(e.currentTarget)
                }
              }}
              data-testid="processlist-info-cell"
            >
              {info}
            </span>
          )
        },
      },
    ],
    [handleInfoCellClick]
  )

  const rowKeyGetter = useCallback((row: Record<string, unknown>) => String(row.id), [])

  const getRowClass = useCallback(
    (row: Record<string, unknown>) => {
      return selectedIds.has(row.id as number) ? 'rdg-row-precision-selected' : undefined
    },
    [selectedIds]
  )

  return (
    <div className={styles.container}>
      <BaseGridView
        rows={gridRows}
        columns={PROCESSLIST_COLUMNS}
        editState={null}
        sortColumn={sortColumn?.columnKey ?? null}
        sortDirection={sortColumn?.direction ?? null}
        onSortChange={handleSortChange}
        rowKeyGetter={rowKeyGetter}
        prefixColumns={prefixColumns}
        suffixColumns={suffixColumns}
        getRowClass={getRowClass}
        applyReadOnlyCellStyles={false}
        testId="processlist-grid-view"
      />
      <InfoCellPopover sql={popoverSql} anchorEl={popoverAnchor} onClose={handleClosePopover} />
    </div>
  )
}
