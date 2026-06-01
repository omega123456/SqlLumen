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
import type {
  GridCellPosition,
  GridColumn,
  GridRowsChangeData,
} from '../components/shared/glide/glide-grid-types'
import type { ForeignKeyColumnInfo, TableDataColumnMeta } from './schema'

// ---------------------------------------------------------------------------
// Column descriptor
// ---------------------------------------------------------------------------

/**
 * Unified column descriptor that bridges TableDataColumnMeta and ColumnMeta.
 * Used by all shared data view components (grid, form, toolbar).
 */
export interface GridColumnDescriptor {
  /** Grid column key (real name or col_N for query results). */
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
  /** SET options if applicable. */
  setValues?: string[]
  /** Optional full table-data column meta for editor factory. */
  tableColumnMeta?: TableDataColumnMeta
  /** FK metadata for this column (set when the column is an FK source). */
  foreignKey?: ForeignKeyColumnInfo
  /** Vendor-neutral editor type used by grid adapters. */
  editorType?: 'text' | 'enum' | 'set' | 'datetime' | 'fk' | 'json' | 'none'
  /**
   * Marks a binary column as opening the shared BLOB viewer on double-click.
   * The inline editor stays `'none'`/`editable: false`; the host recognises the
   * marker to launch `BlobViewerDialog` instead of an inline editor.
   */
  blobViewer?: boolean
  /**
   * True when a binary column is editable through the shared BLOB viewer even
   * though inline text editing remains disabled.
   */
  blobViewerEditable?: boolean
  /** Preferred column width in pixels. */
  width?: number
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
  source?: 'grid-pointer' | 'keyboard' | 'keyboard-typing'
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
  action: 'paste' | 'cut' | 'copy'
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
  onCellSelectionChange?: (args: CellClickGuardArgs) => void
  runCellClickGuardOnKeyboardSelection?: boolean
  onCellClipboardEdit?: (args: CellClipboardEditArgs) => Promise<void> | void
  onColumnResize?: (column: string, width: number) => void
  onRowsChange?: (
    rows: Record<string, unknown>[],
    data: GridRowsChangeData<Record<string, unknown>>
  ) => void
  rowKeyGetter?: (row: Record<string, unknown>) => string
  getRowClass?: (row: Record<string, unknown>) => string | undefined
  selectedRowIndex?: number | null
  selectedCellPosition?: GridCellPosition | null
  onSelectedCellChange?: (pos: GridCellPosition) => void
  selectedRowClassName?: string
  isModifiedCell?: (rowData: Record<string, unknown>, columnKey: string) => boolean
  applyReadOnlyCellStyles?: boolean
  autoSizeConfig?: AutoSizeConfig
  showReadOnlyHeaders?: boolean
  testId?: string
  isEditMode?: boolean
  editableColumnKeys?: ReadonlySet<string>
  onCellValueChange?: (rowIdx: number, columnKey: string, newValue: unknown) => void
  onRowChanging?: (fromRowIdx: number, toRowIdx: number) => Promise<boolean>
  onScrollCellChange?: (scrollRow: number, scrollCol: number) => void
  initialScrollCell?: { scrollRow: number; scrollCol: number }
  scrollToRowIndex?: number | null
  onFkCellAction?: (args: CellClickGuardArgs) => void | Promise<void>
  showInfoColumn?: boolean
  isActive?: boolean

  // Optional insert/delete capabilities (table-data exposes these, query-editor does not)
  onInsertRow?: () => void
  onDeleteRow?: (rowKey: string) => void
  canInsert?: boolean
  canDelete?: boolean

  // General-purpose interaction callbacks
  onCellDoubleClick?: (rowData: Record<string, unknown>, columnKey: string) => void
  onRowClick?: (rowData: Record<string, unknown>, columnKey?: string) => void

  // Column highlight (e.g. FK lookup dialog highlights the referenced column)
  highlightColumnKey?: string

  /**
   * Raw grid columns to prepend before the auto-generated data columns.
   * Useful for adding selection checkboxes or other prefix columns.
   */
  prefixColumns?: ReadonlyArray<GridColumn<Record<string, unknown>>>

  /**
   * Raw grid columns to append after the auto-generated data columns.
   * Useful for adding custom action or display columns at the end.
   */
  suffixColumns?: ReadonlyArray<GridColumn<Record<string, unknown>>>
}

// ---------------------------------------------------------------------------
// Shared form view props
// ---------------------------------------------------------------------------

/** Props shared by known-total and unknown-total form modes. */
interface BaseFormViewCommonProps {
  columns: GridColumnDescriptor[]
  currentRow: unknown[] | null
  currentRowData?: Record<string, unknown> | null
  /** 0-based absolute index across all pages. */
  currentAbsoluteIndex: number
  isFirstRecord: boolean
  onNavigatePrev?: () => void
  onNavigateNext?: () => void
  isLoading?: boolean
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

  /** Passed to portal controls (DateTimePicker, Dropdown) so they auto-dismiss on tab deactivation. */
  workspaceTabId?: string

  /**
   * Invoked when the "View/Edit" affordance beside a binary (BLOB) field is
   * clicked. The host opens the shared BlobViewerDialog for that column/row
   * (edit mode for table-data, view-only for query results). When omitted, the
   * button is not rendered.
   */
  onBlobView?: (column: GridColumnDescriptor, rowData: Record<string, unknown> | null) => void

  /**
   * When true, the BLOB "View/Edit" button is rendered but disabled. Used by the
   * table-data surface when the current row has no resolvable primary key (a
   * read-only connection or a PK-less table), since the grid only holds the
   * placeholder text and cannot lazily fetch the real bytes.
   */
  blobViewDisabled?: boolean

  /** Tooltip explaining why the BLOB "View/Edit" button is disabled. */
  blobViewDisabledReason?: string
}

export interface KnownTotalBaseFormViewProps extends BaseFormViewCommonProps {
  recordCountMode?: 'known'
  totalRows: number
  isLastRecord: boolean
}

export interface UnknownTotalBaseFormViewProps extends BaseFormViewCommonProps {
  recordCountMode: 'unknown'
  totalRows?: number
  isLastRecord?: boolean
}

/** Props for the shared form component. */
export type BaseFormViewProps = KnownTotalBaseFormViewProps | UnknownTotalBaseFormViewProps

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

interface PaginationGroupCommonProps {
  currentPage: number
  pageSize: number
  disabled?: boolean
  /** When true, the page-size dropdown is disabled (e.g. cache-only results). */
  pageSizeDisabled?: boolean
  onPageSizeChange: (size: number) => void
  onPrevPage: () => void
  onNextPage: () => void
}

export interface KnownTotalPaginationGroupProps extends PaginationGroupCommonProps {
  paginationMode?: 'known'
  totalPages: number
  onPageSubmit?: (page: number) => void
}

export interface UnknownTotalPaginationGroupProps extends PaginationGroupCommonProps {
  paginationMode: 'unknown'
  totalPages?: number
  onPageSubmit: (page: number) => void
}

export type PaginationGroupProps = KnownTotalPaginationGroupProps | UnknownTotalPaginationGroupProps

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
