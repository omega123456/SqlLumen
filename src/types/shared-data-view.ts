import type { ReactNode } from 'react'
import type {
  GridCellPosition,
  GridColumn,
  GridRowsChangeData,
} from '../components/shared/glide/glide-grid-types'
import type { ForeignKeyColumnInfo, TableDataColumnMeta } from './schema'

export interface GridColumnDescriptor {
  key: string
  displayName: string
  dataType: string
  editable: boolean
  isBinary: boolean
  isNullable: boolean
  isPrimaryKey: boolean
  isUniqueKey: boolean
  enumValues?: string[]
  setValues?: string[]
  tableColumnMeta?: TableDataColumnMeta
  foreignKey?: ForeignKeyColumnInfo
  editorType?: 'text' | 'enum' | 'set' | 'datetime' | 'fk' | 'json' | 'none'
  blobViewer?: boolean
  blobViewerEditable?: boolean
  width?: number
}

export interface DataViewLocation {
  connectionId: string
  database: string
  table: string
}

export interface RowEditState {
  rowKey: string
  currentValues: Record<string, unknown>
  originalValues: Record<string, unknown>
  isNewRow?: boolean
}

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

export interface AutoSizeConfig {
  enabled: boolean
  computeWidth: (column: GridColumnDescriptor, rows: readonly Record<string, unknown>[]) => number
}

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
  onCellClipboardEdit?: (args: CellClipboardEditArgs) => Promise<boolean> | boolean
  onColumnResize?: (column: string, width: number) => void
  onRowsChange?: (
    rows: Record<string, unknown>[],
    data: GridRowsChangeData<Record<string, unknown>>
  ) => void
  rowKeyGetter?: (row: Record<string, unknown>) => string
  getRowClass?: (row: Record<string, unknown>) => string | undefined
  selectedRowIndex?: number | null
  selectedCellPosition?: GridCellPosition | null
  onSelectedCellChange?: (position: GridCellPosition) => void
  isModifiedCell?: (rowData: Record<string, unknown>, columnKey: string) => boolean
  applyReadOnlyCellStyles?: boolean
  autoSizeConfig?: AutoSizeConfig
  testId?: string
  isEditMode?: boolean
  editableColumnKeys?: ReadonlySet<string>
  onCellValueChange?: (rowIndex: number, columnKey: string, newValue: unknown) => void
  onRowChanging?: (fromRowIndex: number, toRowIndex: number) => Promise<boolean>
  onScrollCellChange?: (scrollRow: number, scrollColumn: number) => void
  initialScrollCell?: { scrollRow: number; scrollCol: number }
  scrollToRowIndex?: number | null
  onFkCellAction?: (args: CellClickGuardArgs) => void | Promise<void>
  showInfoColumn?: boolean
  isActive?: boolean

  onInsertRow?: () => void
  onDeleteRow?: (rowKey: string) => void
  canInsert?: boolean
  canDelete?: boolean

  onCellDoubleClick?: (rowData: Record<string, unknown>, columnKey: string) => void
  onRowClick?: (rowData: Record<string, unknown>, columnKey?: string) => void

  highlightColumnKey?: string

  prefixColumns?: ReadonlyArray<GridColumn<Record<string, unknown>>>

  suffixColumns?: ReadonlyArray<GridColumn<Record<string, unknown>>>
}

interface BaseFormViewCommonProps {
  columns: GridColumnDescriptor[]
  currentRow: unknown[] | null
  currentRowData?: Record<string, unknown> | null
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

  onInsertRow?: () => void
  onDeleteRow?: (rowKey: string) => void
  canInsert?: boolean
  canDelete?: boolean

  workspaceTabId?: string

  onBlobView?: (column: GridColumnDescriptor, rowData: Record<string, unknown> | null) => void

  blobViewDisabled?: boolean

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

export type BaseFormViewProps = KnownTotalBaseFormViewProps | UnknownTotalBaseFormViewProps

export type ViewMode = 'grid' | 'form' | 'text'

export interface ViewModeGroupProps {
  currentMode: ViewMode
  availableModes: readonly ViewMode[]
  onModeChange: (mode: ViewMode) => void
  testIdPrefix?: string
}

interface PaginationGroupCommonProps {
  currentPage: number
  pageSize: number
  disabled?: boolean
  showPageSize?: boolean
  showFirstLastButtons?: boolean
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

export type StatusType = 'idle' | 'loading' | 'success' | 'error'

export interface StatusAreaProps {
  status: StatusType
  totalRows?: number
  countLabel?: ReactNode
  loadingLabel?: ReactNode
  executionTimeMs?: number
  errorMessage?: string
  customContent?: ReactNode
}
