/** Sort direction supported by SqlLumen grid surfaces. */
export type GridSortDirection = 'ASC' | 'DESC'

/**
 * Vendor-neutral column descriptor used by SqlLumen grid abstractions.
 *
 * The base contract is intentionally small (`key` and `name`) while retaining
 * optional presentation/editing fields that existing grid-backed features use.
 * Runtime adapters may translate these fields to a concrete grid library.
 */
export interface GridColumn<TRow> {
  /** Stable column identifier used to read/write row values. */
  key: string
  /** Header label shown to users. */
  name: string | React.ReactElement<unknown, string | React.JSXElementConstructor<unknown>>
  /** Preferred column width in pixels. */
  width?: number | string
  /** Minimum allowed column width in pixels. */
  minWidth?: number
  /** Maximum allowed column width in pixels. */
  maxWidth?: number
  /** Whether users can resize the column. */
  resizable?: boolean
  /** Whether users can sort by the column. */
  sortable?: boolean
  /** Whether the cell can be edited, or an adapter-specific editability predicate. */
  editable?: boolean | ((row: TRow) => boolean)
  /** CSS class name or row-aware class resolver for body cells. */
  cellClass?: string | ((row: TRow) => string | undefined)
  /** CSS class name for the header cell. */
  headerCellClass?: string
  /** Optional custom cell renderer consumed by the active grid adapter. */
  renderCell?: (props: { row: TRow; column: GridColumn<TRow>; rowIdx: number }) => React.ReactNode
  /** Optional custom edit-cell renderer consumed by the active grid adapter. */
  renderEditCell?: (props: {
    row: TRow
    column: GridColumn<TRow>
    rowIdx: number
  }) => React.ReactNode
  /** Optional custom header renderer consumed by the active grid adapter. */
  renderHeaderCell?: (props: { column: GridColumn<TRow> }) => React.ReactNode
  /** Adapter-specific editor options kept opaque at the shared contract layer. */
  editorOptions?: unknown
  /** Allows NULL values. */
  isNullable?: boolean
  /** Binary/BLOB column. */
  isBinary?: boolean
  /** Full table-data column metadata used by cell editors. */
  tableColumnMeta?: unknown
  /** Vendor-neutral editor type used by grid adapters. */
  editorType?: 'text' | 'enum' | 'datetime' | 'fk' | 'none'
  /** Enum options for enum editors. */
  enumValues?: string[]
  /** Allows feature-specific metadata while the shared contract remains vendor-neutral. */
  [key: string]: unknown
}

/** Vendor-neutral single-column sort descriptor. */
export interface GridSortColumn {
  columnKey: string
  direction: GridSortDirection
}

/** Metadata passed when edited rows are committed by a grid adapter. */
export interface GridRowsChangeData<TRow> {
  indexes: number[]
  column: GridColumn<TRow> & { idx?: number }
}

/** Zero-based cell coordinates used for selection and scrolling. */
export interface GridCellPosition {
  rowIdx: number
  idx: number
}

/** Imperative handle exposed by SqlLumen grid components. */
export interface GridHandle {
  scrollToCell: (pos: Partial<GridCellPosition>) => void
  selectCell: (
    pos: GridCellPosition,
    options?: boolean | { enableEditor?: boolean | null; shouldFocusCell?: boolean | null }
  ) => void
  element: HTMLDivElement | null
}
