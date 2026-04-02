/**
 * Shared DataGrid wrapper around react-data-grid.
 *
 * Provides a consistent API surface and applies the Precision Studio theme
 * (rdg-precision CSS class). Row height and header height are sourced from
 * CSS tokens via the useGridDimensions hook.
 *
 * This component does NOT maintain a secondary local rows array — the store
 * is the single source of truth for row data.
 */

import { forwardRef } from 'react'
import { DataGrid as RDG } from 'react-data-grid'
import type {
  DataGridHandle,
  DataGridProps as RDGProps,
  CalculatedColumn,
  SortColumn,
  Renderers,
  DefaultColumnOptions,
  ColumnWidth,
} from 'react-data-grid'
import { useGridDimensions } from '../../hooks/use-grid-dimensions'
import { SortStatusRenderer } from './grid-header-renderers'
import styles from './DataGrid.module.css'

// Re-export types consumers will need
export type { DataGridHandle, CalculatedColumn, Column, SortColumn } from 'react-data-grid'

type CellMouseEventHandler<R, SR> = RDGProps<R, SR>['onCellClick']

// ---------------------------------------------------------------------------
// Props interface
// ---------------------------------------------------------------------------

export interface DataGridWrapperProps<R, SR = unknown> {
  columns: RDGProps<R, SR>['columns']
  rows: readonly R[]
  columnWidths?: ReadonlyMap<string, ColumnWidth>
  onColumnWidthsChange?: (columnWidths: ReadonlyMap<string, ColumnWidth>) => void
  sortColumns?: readonly SortColumn[]
  onSortColumnsChange?: (sortColumns: SortColumn[]) => void
  onCellClick?: CellMouseEventHandler<R, SR>
  onCellDoubleClick?: CellMouseEventHandler<R, SR>
  onCellContextMenu?: RDGProps<R, SR>['onCellContextMenu']
  onCellKeyDown?: RDGProps<R, SR>['onCellKeyDown']
  onCellCopy?: RDGProps<R, SR>['onCellCopy']
  onCellPaste?: RDGProps<R, SR>['onCellPaste']
  onSelectedCellChange?: RDGProps<R, SR>['onSelectedCellChange']
  onRowsChange?: RDGProps<R, SR>['onRowsChange']
  onColumnResize?: (column: CalculatedColumn<R, SR>, width: number) => void
  rowKeyGetter?: RDGProps<R, SR>['rowKeyGetter']
  rowClass?: RDGProps<R, SR>['rowClass']
  defaultColumnOptions?: DefaultColumnOptions<R, SR>
  renderers?: Renderers<R, SR>
  'data-testid'?: string
  className?: string
}

// ---------------------------------------------------------------------------
// DataGrid component
// ---------------------------------------------------------------------------

function DataGridInner<R, SR = unknown>(
  props: DataGridWrapperProps<R, SR>,
  ref: React.Ref<DataGridHandle>
) {
  const {
    columns,
    rows,
    columnWidths,
    onColumnWidthsChange,
    sortColumns,
    onSortColumnsChange,
    onCellClick,
    onCellDoubleClick,
    onCellContextMenu,
    onCellKeyDown,
    onCellCopy,
    onCellPaste,
    onSelectedCellChange,
    onRowsChange,
    onColumnResize,
    rowKeyGetter,
    rowClass,
    defaultColumnOptions,
    renderers: userRenderers,
    'data-testid': testId,
    className,
  } = props

  const { rowHeight, headerHeight } = useGridDimensions()

  // Merge our default sort status renderer with any user-provided renderers
  const mergedRenderers: Renderers<R, SR> = {
    renderSortStatus: SortStatusRenderer,
    ...userRenderers,
  }

  // Build the className — always include rdg-precision, plus any extra classes
  const containerClassName = className ? `rdg-precision ${className}` : 'rdg-precision'

  return (
    <div className={styles.container}>
      <RDG<R, SR>
        ref={ref}
        columns={columns}
        rows={rows}
        columnWidths={columnWidths}
        onColumnWidthsChange={onColumnWidthsChange}
        sortColumns={sortColumns}
        onSortColumnsChange={onSortColumnsChange}
        onCellClick={onCellClick}
        onCellDoubleClick={onCellDoubleClick}
        onCellContextMenu={onCellContextMenu}
        onCellKeyDown={onCellKeyDown}
        onCellCopy={onCellCopy}
        onCellPaste={onCellPaste}
        onSelectedCellChange={onSelectedCellChange}
        onRowsChange={onRowsChange}
        onColumnResize={onColumnResize}
        rowKeyGetter={rowKeyGetter}
        rowClass={rowClass}
        rowHeight={rowHeight}
        headerRowHeight={headerHeight}
        defaultColumnOptions={defaultColumnOptions}
        renderers={mergedRenderers}
        className={containerClassName}
        data-testid={testId}
        enableVirtualization={true}
      />
    </div>
  )
}

/**
 * Shared DataGrid wrapper with forwardRef to expose DataGridHandle.
 * Applies the rdg-precision theme and reads row/header heights from CSS tokens.
 */

export const DataGrid = forwardRef(DataGridInner) as <R, SR = unknown>(
  props: DataGridWrapperProps<R, SR> & { ref?: React.Ref<DataGridHandle> }
) => React.ReactElement | null
