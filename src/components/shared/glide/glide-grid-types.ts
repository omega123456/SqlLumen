export type GridSortDirection = 'ASC' | 'DESC'

export interface GridColumn<TRow> {
  key: string
  name: string | React.ReactElement<unknown, string | React.JSXElementConstructor<unknown>>
  width?: number | string
  minWidth?: number
  maxWidth?: number
  resizable?: boolean
  sortable?: boolean
  editable?: boolean | ((row: TRow) => boolean)
  cellClass?: string | ((row: TRow) => string | undefined)
  headerCellClass?: string
  renderCell?: (props: { row: TRow; column: GridColumn<TRow>; rowIdx: number }) => React.ReactNode
  renderEditCell?: (props: {
    row: TRow
    column: GridColumn<TRow>
    rowIdx: number
  }) => React.ReactNode
  renderHeaderCell?: (props: { column: GridColumn<TRow> }) => React.ReactNode
  editorOptions?: unknown
  isNullable?: boolean
  isBinary?: boolean
  isGenerated?: boolean
  tableColumnMeta?: unknown
  editorType?: 'text' | 'enum' | 'set' | 'datetime' | 'fk' | 'json' | 'none'
  enumValues?: string[]
  setValues?: string[]
  [key: string]: unknown
}

export interface GridSortColumn {
  columnKey: string
  direction: GridSortDirection
}

export interface GridRowsChangeData<TRow> {
  indexes: number[]
  column: GridColumn<TRow> & { idx?: number }
}

export interface GridCellPosition {
  rowIdx: number
  idx: number
}

export interface GridHandle {
  scrollToCell: (
    position: Partial<GridCellPosition>,
    axis?: 'horizontal' | 'vertical' | 'both'
  ) => void
  selectCell: (
    position: GridCellPosition,
    options?: boolean | { enableEditor?: boolean | null; shouldFocusCell?: boolean | null }
  ) => void
  element: HTMLDivElement | null
  updateCells?: (cells: ReadonlyArray<readonly [number, number]>) => void
}
