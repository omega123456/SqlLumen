import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  CompactSelection,
  DataEditor,
  type CellClickedEventArgs,
  type CustomRenderer,
  type DataEditorRef,
  type DrawCellCallback,
  type DrawHeaderCallback,
  type GridCell,
  type GridColumn as GlideGridColumn,
  type GridSelection,
  type Item,
  type Rectangle,
  type EditableGridCell,
  type GridKeyEventArgs,
  type ProvideEditorCallback,
} from '@glideapps/glide-data-grid'
import { useElementSize } from '../../../hooks/use-element-size'
import { useGlideGridTheme } from '../../../hooks/use-glide-grid-theme'
import { useGridDimensions } from '../../../hooks/use-grid-dimensions'
import type { GridHandle } from './glide-grid-types'

export type GlideRowMarkerKind = 'none' | 'checkbox' | 'number' | 'both'

const DEFAULT_ROW_MARKER_WIDTH = 32
const DEFAULT_COLUMN_WIDTH = 120
// Glide's default maxColumnWidth is 500px, which caps how wide a user can drag a
// column. Lift it to an effectively-unreachable value so resizing is unbounded.
const MAX_COLUMN_WIDTH = 100000
const LAYER_REFRESH_DELAY_MS = 100

function getColumnWidth(column: GlideGridColumn): number {
  return 'width' in column && typeof column.width === 'number' ? column.width : DEFAULT_COLUMN_WIDTH
}

function getTargetEditorWidth(element: HTMLElement): number | null {
  const explicitWidth = Number.parseFloat(element.dataset.sqllumenEditorWidth ?? '')
  if (Number.isFinite(explicitWidth) && explicitWidth > 0) {
    return explicitWidth
  }

  const computed = getComputedStyle(element)
  const minWidth = Number.parseFloat(computed.minWidth)
  if (Number.isFinite(minWidth) && minWidth > 0) {
    return minWidth
  }

  const fallbackWidth = Number.parseFloat(computed.width)
  return Number.isFinite(fallbackWidth) && fallbackWidth > 0 ? fallbackWidth : null
}

function constrainGlideEditorOverlay(element: HTMLElement): void {
  const editorRoot = element.querySelector<HTMLElement>('[data-sqllumen-glide-editor-root="true"]')
  if (!editorRoot) return

  element.classList.add('sqllumen-glide-editor-overlay')

  const targetWidth = getTargetEditorWidth(editorRoot)

  if (targetWidth === null || !Number.isFinite(targetWidth) || targetWidth <= 0) return

  const constrainedWidth = `${Math.max(1, Math.floor(targetWidth))}px`

  if (element.style.getPropertyValue('--d19meir1-2') !== constrainedWidth) {
    element.style.setProperty('--d19meir1-2', constrainedWidth)
  }
  if (element.style.width !== constrainedWidth) element.style.width = constrainedWidth
  if (element.style.maxWidth !== constrainedWidth) element.style.maxWidth = constrainedWidth
  if (element.style.overflow !== 'hidden') element.style.overflow = 'hidden'
}

export type GlideDataGridProps<TRow> = {
  columns: GlideGridColumn[]
  rows: readonly TRow[]
  getCellContent: (cell: Item) => GridCell
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

function GlideDataGridInner<TRow>(props: GlideDataGridProps<TRow>, ref: React.Ref<GridHandle>) {
  const {
    columns,
    rows,
    getCellContent,
    onCellEdited,
    onDelete,
    provideEditor,
    onPaste,
    customRenderers,
    onColumnResize,
    onHeaderClicked,
    onCellContextMenu,
    onCellClicked,
    onCellDoubleClicked,
    onCellActivated,
    onFinishedEditing,
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
  const hasSize = size.width > 0 && size.height > 0

  // WebKit (seen with scaled HiDPI modes) intermittently composites a freshly drawn canvas
  // from a stale low-res layer, leaving the grid blurry until the tab is hidden and shown.
  // Briefly promoting the host to its own compositing layer forces a rebuild without hiding
  // anything; re-run once the size settles since every resize reallocates the canvas.
  useEffect(() => {
    const host = hostRef.current
    if (!hasSize || !host) return
    let frame = 0
    const reset = () => {
      host.style.isolation = ''
      host.style.willChange = ''
    }
    const timer = window.setTimeout(() => {
      host.style.isolation = 'isolate'
      host.style.willChange = 'transform'
      frame = requestAnimationFrame(() => (frame = requestAnimationFrame(reset)))
    }, LAYER_REFRESH_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
      cancelAnimationFrame(frame)
      reset()
    }
  }, [hasSize, size])

  useEffect(() => {
    const portal = document.getElementById('portal')
    if (!portal) return

    let animationFrameId: number | null = null
    const constrainOverlays = () => {
      animationFrameId = null
      portal
        .querySelectorAll<HTMLElement>('.gdg-d19meir1')
        .forEach((element) => constrainGlideEditorOverlay(element))
    }
    const scheduleConstrainOverlays = () => {
      if (animationFrameId !== null) return
      animationFrameId = requestAnimationFrame(constrainOverlays)
    }

    scheduleConstrainOverlays()
    const observer = new MutationObserver(scheduleConstrainOverlays)
    observer.observe(portal, {
      attributes: true,
      attributeFilter: ['class', 'style'],
      childList: true,
      subtree: true,
    })

    return () => {
      observer.disconnect()
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
    }
  }, [])

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
      scrollToCell: (pos, axis = 'both') => {
        editorRef.current?.scrollTo(pos.idx ?? 0, pos.rowIdx ?? 0, axis)
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
      onCellActivated?.(cell)
    },
    [onCellActivated]
  )

  const lastClickedCellRef = useRef<Item | null>(null)
  const handleCellClickedWithDoubleClick = useCallback(
    (cell: Item, event: CellClickedEventArgs) => {
      // Glide flags any two mouse-ups within 500ms as a double-click, even across cells.
      const previous = lastClickedCellRef.current
      lastClickedCellRef.current = cell
      const sameCell = previous?.[0] === cell[0] && previous?.[1] === cell[1]
      if (event.isDoubleClick === true && sameCell) {
        onCellDoubleClicked?.(cell, event)
        return
      }
      onCellClicked?.(cell, event)
    },
    [onCellClicked, onCellDoubleClicked]
  )

  const hostClassName = className ? `glide-grid-host ${className}` : 'glide-grid-host'
  const serializedColumnWidths = useMemo(
    () => JSON.stringify(columns.map(getColumnWidth)),
    [columns]
  )
  const rowMarkerWidth = rowMarkers === 'none' ? 0 : DEFAULT_ROW_MARKER_WIDTH
  // Glide only paints an *unchecked* 'checkbox' marker at hover opacity, which makes the
  // column look empty (white, borderless) until the pointer is over a row. Promote it to
  // 'checkbox-visible' so every row's box is always drawn at full opacity.
  const dataEditorRowMarkers = rowMarkers === 'checkbox' ? 'checkbox-visible' : rowMarkers

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
          customRenderers={customRenderers}
          width={size.width}
          height={size.height}
          maxColumnWidth={MAX_COLUMN_WIDTH}
          theme={theme}
          rowHeight={rowHeight}
          headerHeight={headerHeight}
          rowMarkers={dataEditorRowMarkers}
          gridSelection={activeSelection}
          onGridSelectionChange={handleSelectionChange}
          onColumnResize={handleColumnResize}
          onHeaderClicked={(columnIndex) => onHeaderClicked?.(columnIndex)}
          onCellContextMenu={onCellContextMenu}
          onCellClicked={handleCellClickedWithDoubleClick}
          onCellActivated={handleCellActivated}
          onFinishedEditing={onFinishedEditing}
          onVisibleRegionChanged={onVisibleRegionChanged}
          onKeyDown={onKeyDown}
          drawCell={drawCell}
          drawHeader={drawHeader}
          smoothScrollX={false}
          smoothScrollY={false}
          verticalBorder={true}
          cellActivationBehavior="second-click"
          rangeSelect="cell"
          rowSelect={rowMarkers === 'none' ? 'none' : 'multi'}
          rowSelectionMode="multi"
          rowSelectionBlending="mixed"
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
