import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  CompactSelection,
  DataEditor,
  type CellClickedEventArgs,
  type DataEditorRef,
  type DrawCellCallback,
  type DrawHeaderCallback,
  type GridCell,
  type GridColumn as GlideGridColumn,
  type GridSelection,
  type Item,
  type Rectangle,
  type EditableGridCell,
  type ProvideEditorCallback,
} from '@glideapps/glide-data-grid'
import { useElementSize } from '../../../hooks/use-element-size'
import { useGlideGridTheme } from '../../../hooks/use-glide-grid-theme'
import { useGridDimensions } from '../../../hooks/use-grid-dimensions'
import type { GridHandle } from './glide-grid-types'

export type GlideRowMarkerKind = 'none' | 'checkbox' | 'number' | 'both'

const DEFAULT_ROW_MARKER_WIDTH = 32
const DEFAULT_COLUMN_WIDTH = 120

function getColumnWidth(column: GlideGridColumn): number {
  return 'width' in column && typeof column.width === 'number' ? column.width : DEFAULT_COLUMN_WIDTH
}

export type GlideDataGridProps<TRow> = {
  columns: GlideGridColumn[]
  rows: readonly TRow[]
  getCellContent: (cell: Item) => GridCell
  onCellEdited?: (cell: Item, newValue: EditableGridCell) => void
  onDelete?: (selection: GridSelection) => boolean | GridSelection
  provideEditor?: ProvideEditorCallback<GridCell>
  onPaste?: ((target: Item, values: readonly (readonly string[])[]) => boolean) | boolean
  onColumnResize?: (columnIndex: number, newWidth: number) => void
  onHeaderClicked?: (columnIndex: number) => void
  onCellContextMenu?: (cell: Item, event: CellClickedEventArgs) => void
  onCellClicked?: (cell: Item, event: CellClickedEventArgs) => void
  onCellDoubleClicked?: (cell: Item, event: CellClickedEventArgs) => void
  selection?: GridSelection
  onSelectionChange?: (selection: GridSelection) => void
  onVisibleRegionChanged?: (range: Rectangle, tx: number, ty: number) => void
  rowMarkers?: GlideRowMarkerKind
  drawCell?: DrawCellCallback
  drawHeader?: DrawHeaderCallback
  className?: string
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
  'aria-label'?: string
  'data-testid'?: string
}

function GlideDataGridInner<TRow>(props: GlideDataGridProps<TRow>, ref: React.Ref<GridHandle>) {
  const {
    columns,
    rows,
    getCellContent,
    onCellEdited,
    onDelete,
    provideEditor,
    onPaste,
    onColumnResize,
    onHeaderClicked,
    onCellContextMenu,
    onCellClicked,
    onCellDoubleClicked,
    selection,
    onSelectionChange,
    onVisibleRegionChanged,
    rowMarkers = 'none',
    drawCell,
    drawHeader,
    className,
    onKeyDown,
    'aria-label': ariaLabel,
    'data-testid': testId,
  } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<DataEditorRef | null>(null)
  const size = useElementSize(hostRef)
  const theme = useGlideGridTheme()
  const { rowHeight, headerHeight } = useGridDimensions()
  const [internalSelection, setInternalSelection] = useState<GridSelection | undefined>(undefined)
  const activeSelection = selection ?? internalSelection

  const openSelectedCellEditor = useCallback(() => {
    requestAnimationFrame(() => {
      editorRef.current?.focus()
      const canvas = hostRef.current?.querySelector('canvas[data-testid="data-grid-canvas"]')
      canvas?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
        })
      )
    })
  }, [])

  const handleSelectionChange = useCallback(
    (nextSelection: GridSelection) => {
      if (selection === undefined) setInternalSelection(nextSelection)
      onSelectionChange?.(nextSelection)
    },
    [onSelectionChange, selection]
  )

  useImperativeHandle(
    ref,
    () => ({
      scrollToCell: (pos) => {
        editorRef.current?.scrollTo(
          { amount: pos.idx ?? 0, unit: 'px' },
          { amount: pos.rowIdx ?? 0, unit: 'px' },
          'both'
        )
      },
      selectCell: (pos, options) => {
        const enableEditor = typeof options === 'object' ? options.enableEditor === true : false
        const shouldFocusCell =
          typeof options === 'object' ? options.shouldFocusCell !== false : options !== false
        const nextSelection: GridSelection = {
          columns: CompactSelection.empty(),
          rows: CompactSelection.empty(),
          current: {
            cell: [pos.idx, pos.rowIdx],
            range: { x: pos.idx, y: pos.rowIdx, width: 1, height: 1 },
            rangeStack: [],
          },
        }
        handleSelectionChange(nextSelection)
        editorRef.current?.scrollTo(pos.idx, pos.rowIdx, 'both')
        if (shouldFocusCell) editorRef.current?.focus()
        if (enableEditor) openSelectedCellEditor()
      },
      get element() {
        return hostRef.current
      },
    }),
    [handleSelectionChange, openSelectedCellEditor]
  )

  const handleColumnResize = useCallback(
    (_column: GlideGridColumn, newSize: number, colIndex: number) => {
      onColumnResize?.(colIndex, newSize)
    },
    [onColumnResize]
  )

  const handleCellActivated = useCallback(
    (cell: Item) => {
      const [col, row] = cell
      onCellDoubleClicked?.(cell, {
        bounds: editorRef.current?.getBounds(col, row),
      } as CellClickedEventArgs)
    },
    [onCellDoubleClicked]
  )

  const hostClassName = className ? `glide-grid-host ${className}` : 'glide-grid-host'
  const hasSize = size.width > 0 && size.height > 0
  const serializedColumnWidths = useMemo(
    () => JSON.stringify(columns.map(getColumnWidth)),
    [columns]
  )
  const rowMarkerWidth = rowMarkers === 'none' ? 0 : DEFAULT_ROW_MARKER_WIDTH

  return (
    <div
      ref={hostRef}
      className={hostClassName}
      data-testid={testId}
      data-glide-column-width={serializedColumnWidths}
      data-row-marker-width={String(rowMarkerWidth)}
      role="grid"
      aria-label={ariaLabel ?? testId ?? 'Data grid'}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {hasSize ? (
        <DataEditor
          ref={editorRef}
          columns={columns}
          rows={rows.length}
          getCellContent={getCellContent}
          onCellEdited={onCellEdited}
          onDelete={onDelete}
          provideEditor={provideEditor}
          onPaste={onPaste}
          width={size.width}
          height={size.height}
          theme={theme}
          rowHeight={rowHeight}
          headerHeight={headerHeight}
          rowMarkers={rowMarkers}
          gridSelection={activeSelection}
          onGridSelectionChange={handleSelectionChange}
          onColumnResize={handleColumnResize}
          onHeaderClicked={(columnIndex) => onHeaderClicked?.(columnIndex)}
          onCellContextMenu={onCellContextMenu}
          onCellClicked={onCellClicked}
          onCellActivated={handleCellActivated}
          onVisibleRegionChanged={onVisibleRegionChanged}
          drawCell={drawCell}
          drawHeader={drawHeader}
          smoothScrollX={false}
          smoothScrollY={false}
          verticalBorder={true}
          rangeSelect="cell"
          rowSelect={rowMarkers === 'none' ? 'none' : 'multi'}
          columnSelect="none"
          getCellsForSelection={true}
        />
      ) : (
        <div data-testid={testId ? `${testId}-placeholder` : undefined} />
      )}
    </div>
  )
}

export const GlideDataGrid = forwardRef(GlideDataGridInner) as <TRow>(
  props: GlideDataGridProps<TRow> & { ref?: React.Ref<GridHandle> }
) => React.ReactElement | null
