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
  type DataEditorProps,
} from '@glideapps/glide-data-grid'
import { useElementSize } from '../../../hooks/use-element-size'
import { useGlideGridTheme } from '../../../hooks/use-glide-grid-theme'
import { useGridDimensions } from '../../../hooks/use-grid-dimensions'
import type { GridHandle } from './glide-grid-types'
import { isPositiveFiniteNumber } from '../../../lib/value-checks'

export type GlideRowMarkerKind = 'none' | 'checkbox' | 'number' | 'both'

const DEFAULT_ROW_MARKER_WIDTH = 32
const DEFAULT_COLUMN_WIDTH = 120
// Glide's default maxColumnWidth is 500px, which caps how wide a user can drag a
// column. Lift it to an effectively-unreachable value so resizing is unbounded.
const MAX_COLUMN_WIDTH = 100000
const LAYER_REFRESH_DELAY_MS = 100
const GLIDE_OVERLAY_WIDTH_PROPERTY = '--d19meir1-2'

function getColumnWidth(column: GlideGridColumn): number {
  if (!('width' in column)) return DEFAULT_COLUMN_WIDTH
  return typeof column.width === 'number' ? column.width : DEFAULT_COLUMN_WIDTH
}

function getTargetEditorWidth(element: HTMLElement): number | null {
  const explicitWidth = Number.parseFloat(element.dataset.sqllumenEditorWidth ?? '')
  if (isPositiveFiniteNumber(explicitWidth)) {
    return explicitWidth
  }

  const computed = getComputedStyle(element)
  const minWidth = Number.parseFloat(computed.minWidth)
  if (isPositiveFiniteNumber(minWidth)) {
    return minWidth
  }

  const fallbackWidth = Number.parseFloat(computed.width)
  return isPositiveFiniteNumber(fallbackWidth) ? fallbackWidth : null
}

function constrainGlideEditorOverlay(element: HTMLElement): void {
  const editorRoot = element.querySelector<HTMLElement>('[data-sqllumen-glide-editor-root="true"]')
  if (!editorRoot) return

  element.classList.add('sqllumen-glide-editor-overlay')

  const targetWidth = getTargetEditorWidth(editorRoot)

  if (targetWidth === null) return

  const constrainedWidth = `${Math.max(1, Math.floor(targetWidth))}px`
  const overlayStyle = element.style

  const currentOverlayWidth = overlayStyle.getPropertyValue(GLIDE_OVERLAY_WIDTH_PROPERTY)
  if (currentOverlayWidth !== constrainedWidth) {
    overlayStyle.setProperty(GLIDE_OVERLAY_WIDTH_PROPERTY, constrainedWidth)
  }
  if (overlayStyle.width !== constrainedWidth) overlayStyle.width = constrainedWidth
  if (overlayStyle.maxWidth !== constrainedWidth) overlayStyle.maxWidth = constrainedWidth
  if (overlayStyle.overflow !== 'hidden') overlayStyle.overflow = 'hidden'
}

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

const GLIDE_HOST_CLASS = 'glide-grid-host'
const DEFAULT_GRID_ARIA_LABEL = 'Data grid'

function hostClassNameFor(className: string | undefined): string {
  if (!className) return GLIDE_HOST_CLASS
  return `${GLIDE_HOST_CLASS} ${className}`
}

function gridAriaLabel(ariaLabel: string | undefined, testId: string | undefined): string {
  return ariaLabel ?? testId ?? DEFAULT_GRID_ARIA_LABEL
}

function placeholderTestId(testId: string | undefined): string | undefined {
  if (!testId) return undefined
  return `${testId}-placeholder`
}

// Glide only paints an *unchecked* 'checkbox' marker at hover opacity, which makes the
// column look empty (white, borderless) until the pointer is over a row. Promote it to
// 'checkbox-visible' so every row's box is always drawn at full opacity.
function rowMarkerSettings(rowMarkers: GlideRowMarkerKind) {
  if (rowMarkers === 'none') {
    return { width: 0, editorRowMarkers: rowMarkers, rowSelect: 'none' as const }
  }
  return {
    width: DEFAULT_ROW_MARKER_WIDTH,
    editorRowMarkers: rowMarkers === 'checkbox' ? ('checkbox-visible' as const) : rowMarkers,
    rowSelect: 'multi' as const,
  }
}

function GlideDataGridInner<TRow>(props: GlideDataGridProps<TRow>, ref: React.Ref<GridHandle>) {
  const {
    columns,
    rows,
    rowCount,
    getCellContent,
    getCellsForSelection,
    keybindings,
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
    if (!hasSize) return
    if (!host) return
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
      scrollToCell: (position, axis = 'both') => {
        editorRef.current?.scrollTo(position.idx ?? 0, position.rowIdx ?? 0, axis)
      },
      selectCell: (position, options) => {
        const enableEditor = typeof options === 'object' ? options.enableEditor === true : false
        const shouldFocusCell =
          typeof options === 'object' ? options.shouldFocusCell !== false : options !== false
        const nextSelection: GridSelection = {
          columns: CompactSelection.empty(),
          rows: CompactSelection.empty(),
          current: {
            cell: [position.idx, position.rowIdx],
            range: { x: position.idx, y: position.rowIdx, width: 1, height: 1 },
            rangeStack: [],
          },
        }
        handleSelectionChange(nextSelection)
        editorRef.current?.scrollTo(position.idx, position.rowIdx, 'both')
        if (shouldFocusCell) editorRef.current?.focus()
        if (enableEditor) openSelectedCellEditor()
      },
      get element() {
        return hostRef.current
      },
      updateCells: (cells) => {
        editorRef.current?.updateCells(
          cells.map(([column, row]) => ({ cell: [column, row] as Item }))
        )
      },
    }),
    [handleSelectionChange, openSelectedCellEditor]
  )

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

  const lastClickedCellRef = useRef<Item | null>(null)
  const handleCellClickedWithDoubleClick = useCallback(
    (cell: Item, event: CellClickedEventArgs) => {
      // Glide flags any two mouse-ups within 500ms as a double-click, even across cells.
      const previous = lastClickedCellRef.current
      lastClickedCellRef.current = cell
      const sameCell = previous?.[0] === cell[0] && previous?.[1] === cell[1]
      const isSameCellDoubleClick = event.isDoubleClick === true && sameCell
      if (isSameCellDoubleClick) {
        onCellDoubleClicked?.(cell, event)
        return
      }
      onCellClicked?.(cell, event)
    },
    [onCellClicked, onCellDoubleClicked]
  )

  const hostClassName = hostClassNameFor(className)
  const serializedColumnWidths = useMemo(
    () => JSON.stringify(columns.map(getColumnWidth)),
    [columns]
  )
  const markerSettings = rowMarkerSettings(rowMarkers)

  return (
    <div
      ref={hostRef}
      className={hostClassName}
      data-testid={testId}
      data-glide-column-width={serializedColumnWidths}
      data-row-marker-width={String(markerSettings.width)}
      role="grid"
      aria-label={gridAriaLabel(ariaLabel, testId)}
      tabIndex={0}
    >
      {hasSize ? (
        <DataEditor
          ref={editorRef}
          columns={columns}
          rows={rowCount ?? rows.length}
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
          rowMarkers={markerSettings.editorRowMarkers}
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
          rowSelect={markerSettings.rowSelect}
          rowSelectionMode="multi"
          rowSelectionBlending="mixed"
          columnSelect="none"
          getCellsForSelection={getCellsForSelection ?? true}
          keybindings={keybindings}
        />
      ) : (
        <div data-testid={placeholderTestId(testId)} />
      )}
    </div>
  )
}

export const GlideDataGrid = forwardRef(GlideDataGridInner) as <TRow>(
  props: GlideDataGridProps<TRow> & { ref?: React.Ref<GridHandle> }
) => React.ReactElement | null
