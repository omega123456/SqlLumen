import { useCallback, useRef, type RefObject } from 'react'
import {
  DataEditor,
  type CellClickedEventArgs,
  type DataEditorRef,
  type GridColumn as GlideGridColumn,
  type GridSelection,
  type Item,
} from '@glideapps/glide-data-grid'
import { useGlideGridTheme } from '../../../../hooks/use-glide-grid-theme'
import { useGridDimensions } from '../../../../hooks/use-grid-dimensions'
import type { GlideDataGridProps, RowMarkerSettings } from './glide-data-grid-types'

// Glide's default maxColumnWidth is 500px, which caps how wide a user can drag a
// column. Lift it to an effectively-unreachable value so resizing is unbounded.
const MAX_COLUMN_WIDTH = 100000

interface GlideDataEditorProps<TRow> {
  gridProps: GlideDataGridProps<TRow>
  editorRef: RefObject<DataEditorRef | null>
  size: { width: number; height: number }
  activeSelection: GridSelection | undefined
  onSelectionChange: (selection: GridSelection) => void
  markerSettings: RowMarkerSettings
}

function isSameCell(previous: Item | null, cell: Item): boolean {
  return previous?.[0] === cell[0] && previous?.[1] === cell[1]
}

function useGlideCellHandlers<TRow>(gridProps: GlideDataGridProps<TRow>) {
  const { onColumnResize, onCellActivated, onCellClicked, onCellDoubleClicked } = gridProps
  const lastClickedCellRef = useRef<Item | null>(null)

  const handleColumnResize = useCallback(
    (_column: GlideGridColumn, newSize: number, columnIndex: number) => {
      onColumnResize?.(columnIndex, newSize)
    },
    [onColumnResize]
  )

  const handleCellActivated = useCallback(
    (cell: Item) => {
      onCellActivated?.(cell)
    },
    [onCellActivated]
  )

  const handleCellClicked = useCallback(
    (cell: Item, event: CellClickedEventArgs) => {
      // Glide flags any two mouse-ups within 500ms as a double-click, even across cells.
      const previous = lastClickedCellRef.current
      lastClickedCellRef.current = cell
      const isSameCellDoubleClick = event.isDoubleClick === true && isSameCell(previous, cell)
      if (isSameCellDoubleClick) {
        onCellDoubleClicked?.(cell, event)
        return
      }
      onCellClicked?.(cell, event)
    },
    [onCellClicked, onCellDoubleClicked]
  )

  return { handleColumnResize, handleCellActivated, handleCellClicked }
}

export function GlideDataEditor<TRow>(props: GlideDataEditorProps<TRow>) {
  const { gridProps, editorRef, size, markerSettings } = props
  const theme = useGlideGridTheme()
  const { rowHeight, headerHeight } = useGridDimensions()
  const handlers = useGlideCellHandlers(gridProps)
  return (
    <DataEditor
      ref={editorRef}
      columns={gridProps.columns}
      rows={gridProps.rowCount ?? gridProps.rows.length}
      getCellContent={gridProps.getCellContent}
      onCellEdited={gridProps.onCellEdited}
      onDelete={gridProps.onDelete}
      provideEditor={gridProps.provideEditor}
      onPaste={gridProps.onPaste}
      customRenderers={gridProps.customRenderers}
      width={size.width}
      height={size.height}
      maxColumnWidth={MAX_COLUMN_WIDTH}
      theme={theme}
      rowHeight={rowHeight}
      headerHeight={headerHeight}
      rowMarkers={markerSettings.editorRowMarkers}
      gridSelection={props.activeSelection}
      onGridSelectionChange={props.onSelectionChange}
      onColumnResize={handlers.handleColumnResize}
      onHeaderClicked={(columnIndex) => gridProps.onHeaderClicked?.(columnIndex)}
      onCellContextMenu={gridProps.onCellContextMenu}
      onCellClicked={handlers.handleCellClicked}
      onCellActivated={handlers.handleCellActivated}
      onFinishedEditing={gridProps.onFinishedEditing}
      onVisibleRegionChanged={gridProps.onVisibleRegionChanged}
      onKeyDown={gridProps.onKeyDown}
      drawCell={gridProps.drawCell}
      drawHeader={gridProps.drawHeader}
      smoothScrollX={false}
      smoothScrollY={false}
      verticalBorder={true}
      cellActivationBehavior="second-click"
      rangeSelect="cell"
      rowSelect={markerSettings.rowSelect}
      rowSelectionMode="multi"
      rowSelectionBlending="mixed"
      columnSelect="none"
      getCellsForSelection={gridProps.getCellsForSelection ?? true}
      keybindings={gridProps.keybindings}
    />
  )
}
