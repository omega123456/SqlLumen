/**
 * Shared type definitions for the unified data view abstraction layer.
 *
 * These types form the foundation for shared grid, form, and toolbar components
 * that can be used by both the query result view and the table data browser.
 *
 * NOTE: Some types (e.g. RowEditState, ViewMode) have counterparts in schema.ts
 * with different shapes — those are consumer-specific while these are for the
 * shared abstraction layer. Import from the appropriate module.
 */

import type { ReactNode } from 'react'
import type { RowsChangeData } from 'react-data-grid'
import type { ForeignKeyColumnInfo, TableDataColumnMeta } from './schema'

// ---------------------------------------------------------------------------
// Column descriptor
// ---------------------------------------------------------------------------

/**
 * Unified column descriptor that bridges TableDataColumnMeta and ColumnMeta.
 * Used by all shared data view components (grid, form, toolbar).
 */
export interface GridColumnDescriptor {
  /** RDG column key (real name or col_N for query results). */
  key: string
  /** Header display name (always the real column name). */
  displayName: string
  /** SQL data type string. */
  dataType: string
  /** Whether editing is supported for this column. */
  editable: boolean
  /** Binary/BLOB column. */
  isBinary: boolean
  /** Allows NULL. */
  isNullable: boolean
  /** Part of primary key. */
  isPrimaryKey: boolean
  /** Part of unique key. */
  isUniqueKey: boolean
  /** Enum options if applicable. */
  enumValues?: string[]
  /** Optional full table-data column meta for editor factory. */
  tableColumnMeta?: TableDataColumnMeta
  /** FK metadata for this column (set when the column is an FK source). */
  foreignKey?: ForeignKeyColumnInfo
}

// ---------------------------------------------------------------------------
// Row edit state (shared abstraction — lighter than schema.ts RowEditState)
// ---------------------------------------------------------------------------

/**
 * Simplified row edit state for the shared data view layer.
 *
 * Unlike the full RowEditState in schema.ts (which tracks modifiedColumns,
 * isNewRow, tempId, etc.), this version is minimal — consumers adapt their
 * rich edit state into this shape when passing props to shared components.
 */
export interface RowEditState {
  /** Serialised key identifying the row being edited. */
  rowKey: string
  /** Current (possibly modified) values. */
  currentValues: Record<string, unknown>
  /** Original values before editing started. */
  originalValues: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Cell click guard
// ---------------------------------------------------------------------------

export interface CellClickGuardArgs {
  rowIdx: number
  columnKey: string
  rowData: Record<string, unknown>
}

export interface CellClickGuardResult {
  proceed: boolean
  targetRowIdx: number
  targetColIdx: number
  enableEditor: boolean
  restoreFocus?: boolean
}

export interface CellClipboardEditArgs {
  rowIdx: number
  rowData: Record<string, unknown>
  columnKey: string
  action: 'paste' | 'cut'
  text?: string
}

// ---------------------------------------------------------------------------
// Auto-size configuration
// ---------------------------------------------------------------------------

export interface AutoSizeConfig {
  enabled: boolean
  computeWidth: (col: GridColumnDescriptor, rows: Record<string, unknown>[]) => number
}

// ---------------------------------------------------------------------------
// Shared grid view props
// ---------------------------------------------------------------------------

/**
 * Props for the shared grid component.
 * Consumers pre-build rows as Record<string, unknown>[] (NOT unknown[][]).
 */
export interface BaseGridViewProps {
  rows: Record<string, unknown>[]
  columns: GridColumnDescriptor[]
  editState: RowEditState | null
  sortColumn?: string | null
  sortDirection?: 'ASC' | 'DESC' | null
  onSortChange?: (column: string | null, direction: 'ASC' | 'DESC' | null) => void
  onCellClickGuard?: (args: CellClickGuardArgs) => Promise<CellClickGuardResult>
  onCellClipboardEdit?: (args: CellClipboardEditArgs) => Promise<void> | void
  onColumnResize?: (column: string, width: number) => void
  onRowsChange?: (
    rows: Record<string, unknown>[],
    data: RowsChangeData<Record<string, unknown>>
  ) => void
  rowKeyGetter?: (row: Record<string, unknown>) => string
  getRowClass?: (row: Record<string, unknown>) => string | undefined
  isModifiedCell?: (rowData: Record<string, unknown>, columnKey: string) => boolean
  autoSizeConfig?: AutoSizeConfig
  showReadOnlyHeaders?: boolean
  testId?: string

  // Optional insert/delete capabilities (table-data exposes these, query-editor does not)
  onInsertRow?: () => void
  onDeleteRow?: (rowKey: string) => void
  canInsert?: boolean
  canDelete?: boolean

  // General-purpose interaction callbacks
  onCellDoubleClick?: (rowData: Record<string, unknown>, columnKey: string) => void
  onRowClick?: (rowData: Record<string, unknown>) => void

  // Column highlight (e.g. FK lookup dialog highlights the referenced column)
  highlightColumnKey?: string
}

// ---------------------------------------------------------------------------
// Shared form view props
// ---------------------------------------------------------------------------

/** Props for the shared form component. */
export interface BaseFormViewProps {
  columns: GridColumnDescriptor[]
  currentRow: unknown[] | null
  currentRowData?: Record<string, unknown> | null
  totalRows: number
  /** 0-based absolute index across all pages. */
  currentAbsoluteIndex: number
  isFirstRecord: boolean
  isLastRecord: boolean
  onNavigatePrev?: () => void
  onNavigateNext?: () => void
  editState: RowEditState | null
  onEnsureEditing?: () => void
  onUpdateCell?: (columnKey: string, value: unknown) => void
  onSave?: () => void
  onDiscard?: () => void
  readOnly?: boolean
  testId?: string

  // Optional insert/delete capabilities (table-data exposes these, query-editor does not)
  onInsertRow?: () => void
  onDeleteRow?: (rowKey: string) => void
  canInsert?: boolean
  canDelete?: boolean
}

// ---------------------------------------------------------------------------
// View mode
// ---------------------------------------------------------------------------

export type ViewMode = 'grid' | 'form' | 'text'

// ---------------------------------------------------------------------------
// Toolbar item props
// ---------------------------------------------------------------------------

export interface ViewModeGroupProps {
  currentMode: ViewMode
  availableModes: ViewMode[]
  onModeChange: (mode: ViewMode) => void
  testIdPrefix?: string
}

export interface PaginationGroupProps {
  currentPage: number
  totalPages: number
  pageSize: number
  disabled?: boolean
  onPageSizeChange: (size: number) => void
  onPrevPage: () => void
  onNextPage: () => void
}

export interface ExportButtonProps {
  disabled?: boolean
  onClick: () => void
  testId?: string
}

// ---------------------------------------------------------------------------
// Status area
// ---------------------------------------------------------------------------

export type StatusType = 'idle' | 'loading' | 'success' | 'error'

export interface StatusAreaProps {
  status: StatusType
  totalRows?: number
  executionTimeMs?: number
  errorMessage?: string
  customContent?: ReactNode
}
