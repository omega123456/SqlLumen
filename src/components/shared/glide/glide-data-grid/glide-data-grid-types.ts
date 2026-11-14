import type {
  CellClickedEventArgs,
  CustomRenderer,
  DataEditorProps,
  DrawCellCallback,
  DrawHeaderCallback,
  EditableGridCell,
  GridCell,
  GridColumn as GlideGridColumn,
  GridKeyEventArgs,
  GridSelection,
  Item,
  ProvideEditorCallback,
  Rectangle,
} from '@glideapps/glide-data-grid'

export type GlideRowMarkerKind = 'none' | 'checkbox' | 'number' | 'both'

/** Synchronous `getCellsForSelection`: the cells of a rectangle, row by row. */
export type GetCellsForSelection = (selection: Rectangle) => readonly (readonly GridCell[])[]

export type GlideDataGridProps<TRow> = {
  columns: GlideGridColumn[]
  rows: readonly TRow[]
  /** Row count when rows come from a row source instead of `rows` (windowed grids). */
  rowCount?: number
  getCellContent: (cell: Item) => GridCell
  /**
   * Cells for a selection. Defaults to `true` (Glide reads `getCellContent`).
   * Windowed grids pass a synchronous, loaded-rows-only function.
   */
  getCellsForSelection?: GetCellsForSelection
  /** Glide keybinding overrides (windowed grids turn off Glide's own copy). */
  keybindings?: DataEditorProps['keybindings']
  onCellEdited?: (cell: Item, newValue: EditableGridCell) => void
  onDelete?: (selection: GridSelection) => boolean | GridSelection
  provideEditor?: ProvideEditorCallback<GridCell>
  onPaste?: ((target: Item, values: readonly (readonly string[])[]) => boolean) | boolean
  customRenderers?: CustomRenderer[]
  onColumnResize?: (columnIndex: number, newWidth: number) => void
  onHeaderClicked?: (columnIndex: number) => void
  onCellContextMenu?: (cell: Item, event: CellClickedEventArgs) => void
  onCellClicked?: (cell: Item, event: CellClickedEventArgs) => void
  onCellDoubleClicked?: (cell: Item, event: CellClickedEventArgs) => void
  onCellActivated?: (cell: Item) => void
  onFinishedEditing?: (newValue: GridCell | undefined, movement: Item) => void
  selection?: GridSelection
  onSelectionChange?: (selection: GridSelection) => void
  onVisibleRegionChanged?: (range: Rectangle, tx: number, ty: number) => void
  rowMarkers?: GlideRowMarkerKind
  drawCell?: DrawCellCallback
  drawHeader?: DrawHeaderCallback
  className?: string
  onKeyDown?: (event: GridKeyEventArgs) => void
  'aria-label'?: string
  'data-testid'?: string
}

export interface RowMarkerSettings {
  width: number
  editorRowMarkers: 'none' | 'checkbox-visible' | 'number' | 'both'
  rowSelect: 'none' | 'multi'
}

const DEFAULT_ROW_MARKER_WIDTH = 32

// Glide only paints an *unchecked* 'checkbox' marker at hover opacity, which makes the
// column look empty (white, borderless) until the pointer is over a row. Promote it to
// 'checkbox-visible' so every row's box is always drawn at full opacity.
export function rowMarkerSettings(rowMarkers: GlideRowMarkerKind): RowMarkerSettings {
  if (rowMarkers === 'none') {
    return { width: 0, editorRowMarkers: rowMarkers, rowSelect: 'none' }
  }
  return {
    width: DEFAULT_ROW_MARKER_WIDTH,
    editorRowMarkers: rowMarkers === 'checkbox' ? 'checkbox-visible' : rowMarkers,
    rowSelect: 'multi',
  }
}
