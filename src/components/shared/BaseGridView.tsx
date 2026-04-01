/**
 * BaseGridView — shared react-data-grid wrapper for both query results and
 * table data browsing.
 *
 * Implements BaseGridViewProps from shared-data-view.ts. Features:
 * - Controlled column widths with auto-sizing support
 * - Sort state derivation and single-sort enforcement
 * - Cell click guard pattern for async validation before cell selection
 * - Anti-focus-loss editStateRef pattern for stable column definitions
 * - Forwarded ref to DataGridHandle for external cell selection
 *
 * This component does NOT import from any Zustand store — all data and
 * callbacks are received via props, making it fully reusable.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useImperativeHandle,
} from 'react'
import type { CellMouseArgs, CellMouseEvent } from 'react-data-grid'
import { DataGrid } from './DataGrid'
import type { Column, SortColumn, DataGridHandle } from './DataGrid'
import { TableDataCellRenderer } from './grid-cell-renderers'
import { ReadOnlyColumnHeaderCell } from './grid-header-renderers'
import { getCellEditorForColumn } from './grid-cell-editors'
import type { CellEditorCallbackProps } from './grid-cell-editors'
import { getGridCellClass, getDefaultColumnWidth } from '../../lib/grid-column-style'
import type { BaseGridViewProps, CellClickGuardArgs } from '../../types/shared-data-view'
import styles from './BaseGridView.module.css'

// ---------------------------------------------------------------------------
// Stable no-op editor callbacks — editors still function via RDG's
// onRowChange protocol; the consumer's onRowsChange prop handles updates.
// ---------------------------------------------------------------------------

const NOOP_EDITOR_CALLBACKS: CellEditorCallbackProps = {
  tabId: '',
  updateCellValue: () => {},
  syncCellValue: () => {},
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GridRow = Record<string, unknown>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute a stable fingerprint from column keys for change detection. */
function columnKeysFingerprint(columns: { key: string }[]): string {
  return columns.map((c) => c.key).join('\x00')
}

// ---------------------------------------------------------------------------
// BaseGridView component
// ---------------------------------------------------------------------------

function BaseGridViewInner(props: BaseGridViewProps, ref: React.Ref<DataGridHandle>) {
  const {
    rows,
    columns,
    editState,
    sortColumn,
    sortDirection,
    onSortChange,
    onCellClickGuard,
    onColumnResize: onColumnResizeProp,
    onRowsChange: onRowsChangeProp,
    rowKeyGetter: rowKeyGetterProp,
    getRowClass: getRowClassProp,
    isModifiedCell,
    autoSizeConfig,
    showReadOnlyHeaders,
    testId,
  } = props

  const gridRef = useRef<DataGridHandle | null>(null)

  // Forward internal ref to parent
  useImperativeHandle(ref, () => gridRef.current as DataGridHandle, [])

  // ---------------------------------------------------------------------------
  // editStateRef pattern: read inside cellClass closures without adding
  // editState as a useMemo dependency. This prevents column definitions from
  // recomputing on every keystroke during cell editing — critical for
  // preventing focus loss (React would unmount/remount the editor).
  // ---------------------------------------------------------------------------
  const editStateRef = useRef(editState)
  editStateRef.current = editState // update during render, before effects

  // Also store isModifiedCell in a ref for the same anti-focus-loss reason.
  const isModifiedCellRef = useRef(isModifiedCell)
  isModifiedCellRef.current = isModifiedCell // update during render, before effects

  // ---------------------------------------------------------------------------
  // Controlled column-width state
  // Reset when columns change (new column set).
  // ---------------------------------------------------------------------------
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const prevColumnKeysRef = useRef<string>(columnKeysFingerprint(columns))

  useEffect(() => {
    const currentKeys = columnKeysFingerprint(columns)
    if (currentKeys !== prevColumnKeysRef.current) {
      prevColumnKeysRef.current = currentKeys
      setColumnWidths({})
    }
  }, [columns])

  // ---------------------------------------------------------------------------
  // Auto-sized column widths
  //
  // The auto-size computation depends on `rows`. During editing, rows change
  // (to overlay edit state), which would trigger recomputation and in turn
  // recompute `rdgColumns` — causing focus loss. To prevent this, we cache
  // the last computed widths in a ref and skip recomputation when editState
  // is active (non-null). When editing ends (editState → null), the widths
  // are recomputed from the current rows.
  // ---------------------------------------------------------------------------
  const autoColumnWidthsRef = useRef<Record<string, number>>({})

  const autoColumnWidths = useMemo(() => {
    if (!autoSizeConfig?.enabled) return autoColumnWidthsRef.current
    // When in edit mode, return cached widths to avoid focus-loss-causing recomputation
    if (editState != null) return autoColumnWidthsRef.current

    const widths: Record<string, number> = {}
    for (const col of columns) {
      widths[col.key] = autoSizeConfig.computeWidth(col, rows)
    }
    autoColumnWidthsRef.current = widths
    return widths
  }, [autoSizeConfig, columns, rows, editState])

  // ---------------------------------------------------------------------------
  // Column resize handler
  // ---------------------------------------------------------------------------
  const handleColumnResize = useCallback(
    (column: { key: string }, width: number) => {
      setColumnWidths((prev) => ({ ...prev, [column.key]: width }))
      onColumnResizeProp?.(column.key, width)
    },
    [onColumnResizeProp]
  )

  // ---------------------------------------------------------------------------
  // Sort columns: derive from sortColumn/sortDirection props
  // ---------------------------------------------------------------------------
  const sortColumnsRdg: readonly SortColumn[] = useMemo(() => {
    if (sortColumn && sortDirection) {
      return [{ columnKey: sortColumn, direction: sortDirection }]
    }
    return []
  }, [sortColumn, sortDirection])

  const handleSortColumnsChange = useCallback(
    (newSortColumns: SortColumn[]) => {
      if (!onSortChange) return

      // Single-sort enforcement: keep only the LAST element
      const lastSort =
        newSortColumns.length > 0 ? newSortColumns[newSortColumns.length - 1] : undefined

      if (!lastSort) {
        onSortChange(null, null)
        return
      }

      onSortChange(lastSort.columnKey, lastSort.direction as 'ASC' | 'DESC')
    },
    [onSortChange]
  )

  // ---------------------------------------------------------------------------
  // Column definitions: react-data-grid Column[] from GridColumnDescriptor[]
  //
  // CRITICAL: editState and isModifiedCell are read from refs — NOT included
  // in the dependency array. This ensures column definitions stay stable
  // during cell editing, preventing editor unmount/remount (focus loss).
  // ---------------------------------------------------------------------------
  const rdgColumns: readonly Column<GridRow>[] = useMemo(() => {
    const pkColumnNames = columns.filter((c) => c.isPrimaryKey).map((c) => c.key)

    return columns.map((col) => {
      const colWidth =
        columnWidths[col.key] ?? autoColumnWidths[col.key] ?? getDefaultColumnWidth(col.dataType)

      const baseCellClass = getGridCellClass(col.key, col.dataType, pkColumnNames)

      // Dynamic cell class function — reads from refs for anti-focus-loss
      const cellClass = (row: GridRow) => {
        const classes = [baseCellClass]

        if (col.editable) {
          classes.push('rdg-editable-cell')
        } else {
          classes.push('rdg-readonly-cell')
        }

        // Modified cell indicator — reads from refs to avoid triggering
        // rdgColumns recomputation on every keystroke.
        if (editStateRef.current && isModifiedCellRef.current) {
          if (isModifiedCellRef.current(row, col.key)) {
            classes.push('rdg-modified-cell')
          }
        }

        return classes.join(' ')
      }

      // Shared base properties
      const baseProps = {
        key: col.key,
        name: col.displayName,
        width: colWidth,
        resizable: true,
        sortable: !!onSortChange,
        renderCell: TableDataCellRenderer,
        cellClass,
      }

      // Editable column with tableColumnMeta: attach cell editor
      if (col.editable && col.tableColumnMeta) {
        const editorConfig = getCellEditorForColumn(col.tableColumnMeta, NOOP_EDITOR_CALLBACKS)
        return {
          ...baseProps,
          renderEditCell: editorConfig.renderEditCell,
          ...(editorConfig.editorOptions && { editorOptions: editorConfig.editorOptions }),
        } as Column<GridRow>
      }

      // Read-only header for non-editable columns when showReadOnlyHeaders is true
      if (showReadOnlyHeaders && !col.editable) {
        return {
          ...baseProps,
          renderHeaderCell: ReadOnlyColumnHeaderCell,
          headerCellClass: 'rdg-readonly-cell',
        } as Column<GridRow>
      }

      return baseProps as Column<GridRow>
    })
  }, [columns, columnWidths, autoColumnWidths, onSortChange, showReadOnlyHeaders])

  // ---------------------------------------------------------------------------
  // Cell click handler — guard pattern
  //
  // When onCellClickGuard is provided:
  //   1. preventGridDefault() to stop RDG from processing the click
  //   2. Call guard with cell coordinates and row data
  //   3. If guard returns proceed=true, call selectCell to enter editor
  //
  // When no guard is provided, the handler returns early, letting RDG's
  // default cell click behaviour proceed.
  // ---------------------------------------------------------------------------
  const handleCellClick = useCallback(
    async (args: CellMouseArgs<GridRow>, event: CellMouseEvent) => {
      if (!onCellClickGuard) return // No guard — let default behavior happen

      event.preventGridDefault()

      const guardArgs: CellClickGuardArgs = {
        rowIdx: args.rowIdx,
        columnKey: args.column.key,
        rowData: args.row,
      }

      const result = await onCellClickGuard(guardArgs)

      if (result.proceed) {
        gridRef.current?.selectCell(
          { rowIdx: result.targetRowIdx, idx: result.targetColIdx },
          { enableEditor: result.enableEditor }
        )
      }
    },
    [onCellClickGuard]
  )

  // ---------------------------------------------------------------------------
  // onRowsChange handler — delegates to consumer
  // ---------------------------------------------------------------------------
  const handleRowsChange = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (newRows: GridRow[], data: any) => {
      onRowsChangeProp?.(newRows, data)
    },
    [onRowsChangeProp]
  )

  return (
    <div className={styles.container} data-testid={testId ?? 'base-grid-view'}>
      <DataGrid<GridRow>
        ref={gridRef}
        columns={rdgColumns}
        rows={rows}
        sortColumns={sortColumnsRdg}
        onSortColumnsChange={onSortChange ? handleSortColumnsChange : undefined}
        onCellClick={handleCellClick}
        onRowsChange={handleRowsChange}
        onColumnResize={handleColumnResize}
        rowKeyGetter={rowKeyGetterProp}
        rowClass={getRowClassProp}
        data-testid={testId ? `${testId}-inner` : 'base-grid-view-inner'}
      />
    </div>
  )
}

/**
 * Shared grid view component with forwardRef to expose DataGridHandle.
 * Accepts GridColumnDescriptor[] and pre-built Record<string, unknown>[] rows.
 */
export const BaseGridView = forwardRef(BaseGridViewInner) as (
  props: BaseGridViewProps & { ref?: React.Ref<DataGridHandle> }
) => React.ReactElement | null
