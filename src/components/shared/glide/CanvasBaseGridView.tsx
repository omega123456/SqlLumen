import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { ClipboardText, CopySimple, Scissors } from '@phosphor-icons/react'
import {
  CompactSelection,
  type CellClickedEventArgs,
  type DrawCellCallback,
  type DrawHeaderCallback,
  type GridCell,
  type CustomRenderer,
  type GridSelection,
  type EditableGridCell,
  GridCellKind,
  type GridKeyEventArgs,
  type TextCell,
  type BooleanCell,
  type Item,
  type Rectangle,
} from '@glideapps/glide-data-grid'
import {
  DropdownCell as DropdownCellRenderer,
  MultiSelectCell as MultiSelectCellRenderer,
  type DropdownCellType,
  type MultiSelectCellType,
} from '@glideapps/glide-data-grid-cells'
import { AUTO_SIZE_SAMPLE_LIMIT, getDefaultColumnWidth } from '../../../lib/grid-column-style'
import type {
  BaseGridViewProps,
  GridColumnDescriptor,
  RowEditState,
} from '../../../types/shared-data-view'
import {
  buildBlobCell,
  buildNullCell,
  buildTextCell,
  classifyCellValue,
  nullCellThemeOverride,
} from './glide-cell-content'
import { buildGlideColumns } from './glide-column-adapter'
import { drawCustomHeader } from './glide-header-rendering'
import {
  drawFkEllipsis,
  drawHighlightedColumnBackground,
  drawInfoAffordance,
  drawModifiedCellIndicator,
  drawSelectedRowAccent,
  drawSkeletonCell,
} from './glide-drawers'
import {
  createArrayRowSource,
  resolveRowRange,
  type GridRowSource,
  type RowRange,
} from './grid-row-source'
import { useGlideSkeletonColor } from '../../../hooks/use-glide-grid-theme'
import { GlideDataGrid } from './GlideDataGrid'
import type { GridColumn, GridHandle, GridSortColumn } from './glide-grid-types'
import { getGlideEditor } from './glide-editors'
import { parseSetCellValue, serializeSetCellValue } from '../../table-data/enum-field-utils'

import { logFrontend } from '../../../lib/app-log-commands'
import {
  getContextMenuPositionMode,
  getContextMenuPortalRoot,
  positionContextMenuInPortal,
  readClipboardText,
  writeClipboardText,
} from '../../../lib/context-menu-utils'
import { showErrorToast, showSuccessToast, showWarningToast } from '../../../stores/toast-store'
import { formatCount } from '../../../lib/format-row-count'
import {
  CLIPBOARD_ACTION_FAILURES,
  type ClipboardActionFailure,
} from '../../../lib/clipboard-action-failures'
type GridRow = Record<string, unknown>
type GlideKeyDownEvent = GridKeyEventArgs
type GlideDropdownOption = string | { value: string; label: string }
type ScrollCell = { scrollRow: number; scrollCol: number }

interface EditorSessionBaseline {
  rowIndex: number
  columnKey: string
  value: unknown
}

interface PendingTypingActivation {
  rowIndex: number
  columnKey: string
  value: string
  cancelRestoreValue: unknown
}

function isTypingActivationKey(event: GlideKeyDownEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) return false
  if (event.key.length !== 1) return false
  return event.key !== '\r' && event.key !== '\n'
}

function normalizeEditorValue(value: unknown): unknown {
  if (Array.isArray(value)) return value
  return value == null ? null : String(value)
}

function areEditorValuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    if (left.length !== right.length) return false
    return left.every((value, index) => Object.is(value, right[index]))
  }
  return Object.is(left, right)
}

function deriveNullSentinel(enumValues: string[]): string {
  for (let i = 0; i <= 31; i += 1) {
    const candidate = String.fromCharCode(i)
    if (!enumValues.includes(candidate)) return candidate
  }
  let index = 0
  while (true) {
    const candidate = `\0NULL${index}`
    if (!enumValues.includes(candidate)) return candidate
    index += 1
  }
}

function buildEnumAllowedValues(column: EnumGridColumn): GlideDropdownOption[] {
  if (column.isNullable !== true) return column.enumValues
  return [{ value: deriveNullSentinel(column.enumValues), label: 'NULL' }, ...column.enumValues]
}

function getDropdownOptionValue(option: GlideDropdownOption | null | undefined): string | null {
  if (typeof option === 'string') return option
  return option?.value ?? null
}

function isDropdownNullSelection(
  column: EnumGridColumn,
  value: string | null | undefined
): boolean {
  if (column.isNullable !== true || value == null) return false
  return getDropdownOptionValue(buildEnumAllowedValues(column)[0]) === value
}

/** Grid well (prototype `.p-grid`): a divider sits above the header row. */
const GRID_WELL_STYLE: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  flex: 1,
  minHeight: 0,
  boxSizing: 'border-box',
  borderTop: '1px solid var(--stroke-divider)',
}

export interface CanvasBaseGridViewProps extends BaseGridViewProps {
  rowMarkers?: 'none' | 'checkbox' | 'number' | 'both'
  onRowMarkersChange?: (selectedRows: GridRow[]) => void
  onInfoCellClick?: (row: GridRow, anchorRect: DOMRect) => void
  onSelectedRowChange?: (row: GridRow | null, rowIndex: number | null) => void
  onRowDoubleClicked?: (row: GridRow) => void
  /**
   * Monotonic signal used by callers to force the grid to clear its internal
   * row-marker (checkbox) selection. Whenever this value changes, the grid
   * resets `gridSelection.rows` to empty. This lets stores that own the
   * checked-row state (e.g. after a bulk delete) push a reset down to the grid
   * so stale visual checkmarks no longer point at shifted rows.
   */
  resetSelectionKey?: number
  /**
   * Row source. When given (windowed mode), rows are read through it instead of
   * `rows`: missing rows render as skeleton cells, the visible range is
   * reported to it, and Copy/Cut/Clear/Paste fetch unloaded rows first.
   */
  rowSource?: GridRowSource<GridRow>
  /** Windowed mode: checked rows as half-open view-position ranges (D17). */
  onRowMarkerRangesChange?: (ranges: RowRange[]) => void
  /** Windowed mode: progress and expiry hooks for actions that fetch unloaded rows. */
  rowActions?: GridRowActions
}

/** Verbs of grid actions that may need to fetch unloaded rows first (wireframe 8). */
export type GridRowActionVerb = 'Copying' | 'Cutting' | 'Clearing' | 'Pasting'

/** Progress hooks a windowed grid uses for actions over unloaded rows. */
export interface GridRowActions {
  /**
   * Start tracking an action over `total` rows. `onCancel` is given when the
   * fetch spans more than one 2,000-row chunk. `finish()` returns true when the
   * progress became visible (the 1 s threshold), which gates the success toast.
   */
  begin: (
    verb: GridRowActionVerb,
    total: number,
    onCancel?: () => void
  ) => { update: (done: number) => void; finish: () => boolean }
  /** The cached result expired: route to the "Results expired" block (no toast). */
  onExpired: () => void
}

/** Rows per fetch chunk; a cancel button appears for fetches spanning more than one. */
const ROW_FETCH_CHUNK = 2000
/** Rows repainted after a page loads when the visible region isn't known yet. */
const VISIBLE_REPAINT_FALLBACK_ROWS = 200
/** Skeleton bar height when the theme has no cell font size. */
const SKELETON_FALLBACK_LINE_PX = 13
const EMPTY_GRID_ROWS: GridRow[] = []

/** Wireframe 8 failure copy per action verb (fetch and clipboard failures alike). */
const ROW_ACTION_FAILURES: Record<GridRowActionVerb, ClipboardActionFailure> = {
  Copying: CLIPBOARD_ACTION_FAILURES.copy,
  Cutting: CLIPBOARD_ACTION_FAILURES.cut,
  Clearing: CLIPBOARD_ACTION_FAILURES.clear,
  Pasting: CLIPBOARD_ACTION_FAILURES.paste,
}

/** Windowed grids route Copy and Cut through the app's own async path (D21). */
const WINDOWED_KEYBINDINGS = { copy: false, cut: false } as const

function rowActionSuccess(verb: GridRowActionVerb, count: number): [string, string] {
  const rows = `${formatCount(count)} ${count === 1 ? 'row' : 'rows'}`
  switch (verb) {
    case 'Copying':
      return ['Copied', `${rows} copied to clipboard.`]
    case 'Cutting':
      return ['Cut', `${rows} cut.`]
    case 'Clearing':
      return ['Cleared', `${rows} cleared.`]
    case 'Pasting':
      return ['Pasted', `${rows} updated.`]
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** The index in `next` that `previous` lacks (when exactly one was added). */
function findAddedIndex(next: CompactSelection, previous: CompactSelection): number | undefined {
  for (const index of next) {
    if (!previous.hasIndex(index)) return index
  }
  return undefined
}

/**
 * Half-open row ranges covered by a row selection (a Glide `CompactSelection`,
 * with a fast path for one contiguous run, or any iterable of row indices).
 */
function selectionRowRanges(selection: CompactSelection | Iterable<number>): RowRange[] {
  if (selection instanceof CompactSelection) {
    const first = selection.first()
    const last = selection.last()
    if (first === undefined || last === undefined) return []
    if (last - first + 1 === selection.length) return [[first, last + 1]]
  }
  const ranges: Array<[number, number]> = []
  for (const index of [...selection].sort((a, b) => a - b)) {
    const current = ranges[ranges.length - 1]
    if (current && current[1] === index) current[1] = index + 1
    else ranges.push([index, index + 1])
  }
  return ranges
}

/** Merge half-open ranges (clamped to `[0, rowCount)`), sorted and non-overlapping. */
function mergeRowRanges(ranges: readonly RowRange[], rowCount: number): Array<[number, number]> {
  const sorted = ranges
    .map(([start, end]): [number, number] => [Math.max(0, start), Math.min(rowCount, end)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

/** Row ranges covered by selection rectangles. */
function rectRowRanges(rects: readonly Rectangle[]): RowRange[] {
  return rects.map((rect) => [rect.y, rect.y + rect.height] as const)
}

/** True when every row of `[start, end)` is loaded in the source. */
function isRangeLoaded<TRow>(source: GridRowSource<TRow>, start: number, end: number): boolean {
  for (let index = start; index < end; index++) {
    if (!source.isLoaded(index)) return false
  }
  return true
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** `results_expired` failures route to the "Results expired" block, not a toast. */
function isResultsExpired(error: unknown): boolean {
  return errorText(error).includes('results_expired')
}

function toGridColumn(
  column: GridColumnDescriptor,
  rows: readonly GridRow[],
  autoSizeConfig: CanvasBaseGridViewProps['autoSizeConfig']
): GridColumn<GridRow> {
  const computedWidth =
    typeof column.width === 'number'
      ? column.width
      : autoSizeConfig?.enabled === true
        ? autoSizeConfig.computeWidth(column, rows)
        : undefined
  return {
    key: column.key,
    name: column.displayName,
    dataType: column.dataType,
    width:
      computedWidth ??
      (column.editable
        ? getDefaultColumnWidth(column.dataType)
        : getDefaultColumnWidth(column.dataType) + 14),
    resizable: true,
    sortable: true,
    editable: column.editable,
    foreignKey: column.foreignKey,
    isNullable: column.isNullable,
    isBinary: column.isBinary,
    blobViewerEditable: column.blobViewerEditable,
    tableColumnMeta: column.tableColumnMeta,
    editorType: column.editorType,
    enumValues: column.enumValues,
    setValues: column.setValues,
  }
}

function isInfoColumn(column: GridColumn<GridRow>): boolean {
  return column.key === 'info'
}

type EnumGridColumn = GridColumn<GridRow> & { enumValues: string[]; editorType: 'enum' }
type SetGridColumn = GridColumn<GridRow> & { setValues: string[]; editorType: 'set' }

function isEnumColumn(column: GridColumn<GridRow> | undefined): column is EnumGridColumn {
  return (
    column?.editorType === 'enum' &&
    Array.isArray(column.enumValues) &&
    column.enumValues.length > 0
  )
}

function isSetColumn(column: GridColumn<GridRow> | undefined): column is SetGridColumn {
  return (
    column?.editorType === 'set' && Array.isArray(column.setValues) && column.setValues.length > 0
  )
}

function isListSelectionColumn(
  column: GridColumn<GridRow> | undefined
): column is EnumGridColumn | SetGridColumn {
  return isEnumColumn(column) || isSetColumn(column)
}

function isEditableColumn(
  column: GridColumn<GridRow>,
  isEditMode: boolean | undefined,
  editableColumnKeys: ReadonlySet<string> | undefined
): boolean {
  return (
    isEditMode === true &&
    column.editable === true &&
    editableColumnKeys?.has(column.key) === true &&
    column.isBinary !== true &&
    column.editorType !== 'none'
  )
}

function isDropdownCustomCell(cell: EditableGridCell): cell is DropdownCellType {
  return (
    cell.kind === GridCellKind.Custom &&
    typeof cell.data === 'object' &&
    cell.data !== null &&
    'kind' in cell.data &&
    cell.data.kind === 'dropdown-cell'
  )
}

function isMultiSelectCustomCell(cell: EditableGridCell): cell is MultiSelectCellType {
  return (
    cell.kind === GridCellKind.Custom &&
    typeof cell.data === 'object' &&
    cell.data !== null &&
    'kind' in cell.data &&
    cell.data.kind === 'multi-select-cell'
  )
}

function buildEnumDropdownCell(
  column: EnumGridColumn,
  value: string | null,
  editable: boolean
): DropdownCellType {
  const allowedValues = buildEnumAllowedValues(column)
  const nullSentinel = getDropdownOptionValue(allowedValues[0])

  return {
    kind: GridCellKind.Custom,
    allowOverlay: editable,
    readonly: !editable,
    copyData: value ?? 'NULL',
    ...(value == null ? { themeOverride: nullCellThemeOverride() } : {}),
    data: {
      kind: 'dropdown-cell',
      value: value ?? nullSentinel,
      allowedValues,
    },
  }
}

function buildSetMultiSelectCell(
  column: SetGridColumn,
  value: string | null,
  editable: boolean
): MultiSelectCellType {
  return {
    kind: GridCellKind.Custom,
    allowOverlay: editable,
    readonly: !editable,
    copyData: value ?? 'NULL',
    ...(value == null ? { themeOverride: nullCellThemeOverride() } : {}),
    data: {
      kind: 'multi-select-cell',
      values: parseSetCellValue(value) ?? null,
      options: column.setValues,
      allowCreation: false,
      allowDuplicates: false,
    },
  }
}

function clampScrollCell(scrollCell: ScrollCell, maxRow: number, maxCol: number): ScrollCell {
  return {
    scrollRow: Math.max(0, Math.min(maxRow, Math.floor(scrollCell.scrollRow))),
    scrollCol: Math.max(0, Math.min(maxCol, Math.floor(scrollCell.scrollCol))),
  }
}

function isSameScrollCell(a: ScrollCell | null, b: ScrollCell): boolean {
  return a?.scrollRow === b.scrollRow && a.scrollCol === b.scrollCol
}

const INFO_AFFORDANCE_GUTTER_PX = 28
const CUSTOM_RENDERERS: CustomRenderer[] = [
  DropdownCellRenderer as unknown as CustomRenderer,
  MultiSelectCellRenderer as unknown as CustomRenderer,
]

/**
 * The edited cell Glide's paste would produce for `text` in `cell`, or
 * undefined when the cell is read-only or the value is unchanged (mirrors
 * Glide's `pasteToCell` for the text and enum/SET cells that descriptor
 * columns render; checkbox cells only exist for non-descriptor columns).
 */
function pasteTextIntoCell(cell: GridCell, text: string): EditableGridCell | undefined {
  if (cell.kind === GridCellKind.Text) {
    if (cell.readonly === true || text === cell.data) return undefined
    return { ...cell, data: text }
  }
  if (cell.kind === GridCellKind.Custom) {
    if (cell.readonly === true) return undefined
    const renderer = CUSTOM_RENDERERS.find((candidate) => candidate.isMatch(cell))
    const data = renderer?.onPaste?.(text, cell.data)
    return data === undefined ? undefined : { ...cell, data }
  }
  return undefined
}

function resolveEditorBaselineValue(
  row: GridRow,
  columnKey: string,
  editState: RowEditState | null
): unknown {
  if (Object.prototype.hasOwnProperty.call(editState?.currentValues ?? {}, columnKey)) {
    return editState?.currentValues[columnKey]
  }

  if (Object.prototype.hasOwnProperty.call(editState?.originalValues ?? {}, columnKey)) {
    return editState?.originalValues[columnKey]
  }

  return row[columnKey]
}

function CanvasBaseGridViewInner(props: CanvasBaseGridViewProps, ref: React.Ref<GridHandle>) {
  const {
    rows: rowsProp,
    rowSource,
    onRowMarkerRangesChange,
    rowActions,
    columns,
    sortColumn,
    sortDirection,
    onSortChange,
    onColumnResize,
    onCellSelectionChange,
    onCellDoubleClick,
    onRowClick,
    highlightColumnKey,
    selectedRowIndex,
    onRowMarkersChange,
    getRowClass,
    isModifiedCell,
    testId,
    rowMarkers = 'none',
    onInfoCellClick,
    onSelectedRowChange,
    onRowDoubleClicked,
    selectedCellPosition,
    onSelectedCellChange,
    isEditMode,
    editableColumnKeys,
    onCellValueChange,
    onRowChanging,
    onCellClipboardEdit,
    onCellClickGuard,
    editState,
    onRowsChange,
    onScrollCellChange,
    initialScrollCell,
    scrollToRowIndex,
    onFkCellAction,
    showInfoColumn = false,
    isActive = true,
    runCellClickGuardOnKeyboardSelection = false,
    resetSelectionKey,
  } = props
  const gridRef = useRef<GridHandle | null>(null)
  const [internalSelectedRowIndex, setInternalSelectedRowIndex] = useState<number | null>(null)
  const [gridSelection, setGridSelection] = useState<GridSelection | undefined>(undefined)
  const [lastResetSelectionKey, setLastResetSelectionKey] = useState<number | undefined>(
    resetSelectionKey
  )
  const [internalColumnWidths, setInternalColumnWidths] = useState<Record<string, number>>({})
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    portalRoot: HTMLElement
  } | null>(null)
  const clipboardMenuRef = useRef<HTMLDivElement>(null)
  const lastInteractedCellRef = useRef<{ rowIdx: number; idx: number } | null>(null)
  // Tracks the previously reported row-marker selection so we only notify the
  // parent (and write to the store) when the checked rows actually change —
  // plain cell clicks / keyboard navigation must not churn checkbox state.
  const prevMarkedRowsRef = useRef<number[]>([])
  const prevMarkedRangesKeyRef = useRef('[]')
  const lastSelectedListCellRef = useRef<{ rowIdx: number; idx: number } | null>(null)
  const lastAppliedInitialScrollRef = useRef<{ scrollRow: number; scrollCol: number } | null>(null)
  const lastReportedScrollCellRef = useRef<ScrollCell | null>(null)
  const pendingInitialScrollRestoreRef = useRef<ScrollCell | null>(null)
  const suppressScrollPersistenceRef = useRef(false)
  const isEditingCellRef = useRef(false)
  const editorSessionBaselineRef = useRef<EditorSessionBaseline | null>(null)
  const pendingTypingActivationRef = useRef<PendingTypingActivation | null>(null)
  const listEditorOpeningRef = useRef(false)
  const activeSelectedRowIndex = selectedRowIndex ?? internalSelectedRowIndex
  const source = useMemo<GridRowSource<GridRow>>(
    () => rowSource ?? createArrayRowSource(rowsProp),
    [rowSource, rowsProp]
  )
  const isWindowed = source.kind === 'windowed'
  const rowCount = source.rowCount
  const skeletonColor = useGlideSkeletonColor()
  // Auto-size samples only loaded rows (in windowed mode, the first window).
  const autoSizeSampleRows = useMemo<readonly GridRow[]>(() => {
    if (!isWindowed) return rowsProp
    const sample: GridRow[] = []
    for (
      let index = 0;
      index < source.rowCount && sample.length < AUTO_SIZE_SAMPLE_LIMIT;
      index++
    ) {
      const row = source.getRow(index)
      if (!row) break
      sample.push(row)
    }
    return sample
  }, [isWindowed, rowsProp, source])
  /** True while a windowed action is fetching rows: blocks other actions and edits. */
  const actionPendingRef = useRef(false)
  const actionAbortRef = useRef<AbortController | null>(null)
  const lastVisibleRegionRef = useRef<Rectangle | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      scrollToCell: (pos, axis) => {
        pendingInitialScrollRestoreRef.current = null
        suppressScrollPersistenceRef.current = false
        gridRef.current?.scrollToCell(pos, axis)
      },
      selectCell: (pos, options) => {
        pendingInitialScrollRestoreRef.current = null
        suppressScrollPersistenceRef.current = false
        gridRef.current?.selectCell(pos, options)
      },
      get element() {
        return gridRef.current?.element ?? null
      },
    }),
    []
  )

  const openListEditor = useCallback((cell: { rowIdx: number; idx: number }): void => {
    if (listEditorOpeningRef.current) return
    listEditorOpeningRef.current = true
    gridRef.current?.selectCell(cell, { shouldFocusCell: true, enableEditor: true })
    requestAnimationFrame(() => {
      listEditorOpeningRef.current = false
    })
  }, [])

  const isRowSelected = useCallback(
    (row: GridRow): boolean => {
      return getRowClass?.(row)?.includes('selected') === true
    },
    [getRowClass]
  )

  const isRowEditing = useCallback(
    (row: GridRow): boolean => getRowClass?.(row)?.includes('editing-row') === true,
    [getRowClass]
  )

  const gridColumns = useMemo<GridColumn<GridRow>[]>(() => {
    const dataColumns = columns.map((column) =>
      toGridColumn(column, autoSizeSampleRows, props.autoSizeConfig)
    )
    const infoColumns: GridColumn<GridRow>[] = showInfoColumn
      ? [{ key: 'info', name: 'Info', width: 260, resizable: true, sortable: true }]
      : []
    const nextColumns = [
      ...(props.prefixColumns ?? []),
      ...dataColumns,
      ...infoColumns,
      ...(props.suffixColumns ?? []),
    ]

    if (onColumnResize) return nextColumns

    return nextColumns.map((column) => {
      const width = internalColumnWidths[column.key]
      return typeof width === 'number' ? { ...column, width } : column
    })
  }, [
    columns,
    internalColumnWidths,
    onColumnResize,
    props.autoSizeConfig,
    props.prefixColumns,
    props.suffixColumns,
    autoSizeSampleRows,
    showInfoColumn,
  ])

  const glideColumns = useMemo(
    () => buildGlideColumns(gridColumns, { hasRowMarker: rowMarkers !== 'none' }),
    [gridColumns, rowMarkers]
  )

  const activeGridSelection = useMemo<GridSelection | undefined>(() => {
    if (!selectedCellPosition) return gridSelection
    return {
      columns: gridSelection?.columns ?? CompactSelection.empty(),
      rows: gridSelection?.rows ?? CompactSelection.empty(),
      current: {
        cell: [selectedCellPosition.idx, selectedCellPosition.rowIdx] as [number, number],
        range: {
          x: selectedCellPosition.idx,
          y: selectedCellPosition.rowIdx,
          width: 1,
          height: 1,
        },
        rangeStack: [],
      },
    }
  }, [gridSelection, selectedCellPosition])

  const changeSelectedCell = useCallback(
    async (rowIndex: number, colIndex: number): Promise<boolean> => {
      const fromRow = selectedCellPosition?.rowIdx ?? activeSelectedRowIndex
      if (fromRow != null && fromRow !== rowIndex && onRowChanging) {
        const ok = await onRowChanging(fromRow, rowIndex)
        if (!ok) {
          if (selectedCellPosition)
            gridRef.current?.selectCell(selectedCellPosition, { shouldFocusCell: true })
          return false
        }
      }
      onSelectedCellChange?.({ rowIdx: rowIndex, idx: colIndex })
      return true
    },
    [activeSelectedRowIndex, onRowChanging, onSelectedCellChange, selectedCellPosition]
  )

  const selectRow = useCallback(
    (rowIndex: number | null) => {
      const row = rowIndex == null ? null : (source.getRow(rowIndex) ?? null)
      const nextIndex = row == null ? null : rowIndex
      setInternalSelectedRowIndex(nextIndex)
      onSelectedRowChange?.(row, nextIndex)
    },
    [onSelectedRowChange, source]
  )

  const sortColumns = useMemo<GridSortColumn[]>(() => {
    return sortColumn && sortDirection ? [{ columnKey: sortColumn, direction: sortDirection }] : []
  }, [sortColumn, sortDirection])

  useLayoutEffect(() => {
    if (!initialScrollCell || rowCount === 0 || gridColumns.length === 0) return
    const normalized = clampScrollCell(initialScrollCell, rowCount - 1, gridColumns.length - 1)
    const lastApplied = lastAppliedInitialScrollRef.current
    if (isSameScrollCell(lastApplied, normalized)) {
      return
    }

    const lastReported = lastReportedScrollCellRef.current
    if (isSameScrollCell(lastReported, normalized)) {
      lastAppliedInitialScrollRef.current = normalized
      pendingInitialScrollRestoreRef.current = null
      suppressScrollPersistenceRef.current = false
      return
    }

    lastAppliedInitialScrollRef.current = normalized
    pendingInitialScrollRestoreRef.current = normalized
    suppressScrollPersistenceRef.current = true

    let releaseSuppressionFrameId = 0
    const restoreFrameId = requestAnimationFrame(() => {
      if (!isSameScrollCell(pendingInitialScrollRestoreRef.current, normalized)) return
      gridRef.current?.scrollToCell({ rowIdx: normalized.scrollRow, idx: normalized.scrollCol })
      releaseSuppressionFrameId = requestAnimationFrame(() => {
        // Only release suppression if the pending restore already resolved
        // (handleVisibleRegionChanged saw the target position). When the
        // DataEditor was not yet mounted during the scrollToCell call above,
        // pendingInitialScrollRestoreRef is still set and suppression must stay
        // active so handleVisibleRegionChanged can retry the scroll.
        if (pendingInitialScrollRestoreRef.current === null) {
          suppressScrollPersistenceRef.current = false
        }
      })
    })

    return () => {
      cancelAnimationFrame(restoreFrameId)
      if (releaseSuppressionFrameId !== 0) {
        cancelAnimationFrame(releaseSuppressionFrameId)
      }
      if (isSameScrollCell(pendingInitialScrollRestoreRef.current, normalized)) {
        pendingInitialScrollRestoreRef.current = null
      }
      suppressScrollPersistenceRef.current = false
    }
  }, [gridColumns.length, initialScrollCell, rowCount])

  useEffect(() => {
    if (scrollToRowIndex == null || scrollToRowIndex < 0) return
    requestAnimationFrame(() => {
      gridRef.current?.selectCell({ rowIdx: scrollToRowIndex, idx: 0 }, { shouldFocusCell: true })
    })
  }, [scrollToRowIndex])

  // Clear the internal row-marker (checkbox) selection when the caller bumps
  // resetSelectionKey. After a bulk delete the rows array shrinks and the stale
  // CompactSelection.rows would otherwise keep visual checkmarks on shifted
  // rows even though the owning store's checked set is already empty. Uses the
  // "adjust state during render" pattern (not an effect) so the marks clear in
  // the same render that observes the new key.
  if (resetSelectionKey != null && lastResetSelectionKey !== resetSelectionKey) {
    setLastResetSelectionKey(resetSelectionKey)
    prevMarkedRangesKeyRef.current = '[]'
    setGridSelection((current) => {
      if (!current || current.rows.length === 0) return current
      return { ...current, rows: CompactSelection.empty() }
    })
  }

  /** Build the cell for `row` (a loaded row object) at `[colIndex, rowIndex]`. */
  const buildCellForRow = useCallback(
    (row: GridRow, colIndex: number, rowIndex: number): GridCell => {
      const column = gridColumns[colIndex]
      if (!column) return buildTextCell('', classifyCellValue('', ''))
      const rawValue = row[column.key]
      if (column.cellKind === 'checkbox') {
        return {
          kind: GridCellKind.Boolean,
          data: rawValue === true,
          allowOverlay: false,
          readonly: false,
        } satisfies BooleanCell
      }
      const flags = classifyCellValue(rawValue, column.key, {
        isReadOnly: isEditMode === true && editableColumnKeys?.has(column.key) !== true,
        isModified: isModifiedCell?.(row, column.key) ?? false,
        isFkCell: column.foreignKey != null,
        isBlobColumn: column.isBinary === true,
        isSelectedRow: activeSelectedRowIndex === rowIndex || isRowSelected(row),
        isEditingRow: isRowEditing(row),
        highlightedColumnKey: highlightColumnKey,
      })
      if (flags.isBlob) return buildBlobCell(flags.displayValue, flags.copyValue)
      const editable = isEditableColumn(column, isEditMode, editableColumnKeys)
      if (flags.isNull && !editable) return buildNullCell(flags.copyValue)
      if (isEnumColumn(column)) {
        const enumValue = rawValue == null ? null : String(rawValue)
        return buildEnumDropdownCell(column, enumValue, editable)
      }
      if (isSetColumn(column)) {
        const setValue = rawValue == null ? null : String(rawValue)
        return buildSetMultiSelectCell(column, setValue, editable)
      }
      if (editable) {
        const baseCell = flags.isNull
          ? buildNullCell(flags.copyValue)
          : buildTextCell(flags.displayValue, flags, flags.copyValue)
        const pendingTypingActivation =
          pendingTypingActivationRef.current?.rowIndex === rowIndex &&
          pendingTypingActivationRef.current?.columnKey === column.key
            ? pendingTypingActivationRef.current
            : null
        return {
          ...baseCell,
          readonly: false,
          allowOverlay: true,
          data: rawValue == null ? '' : String(rawValue),
          glideEditorData: {
            row,
            columnKey: column.key,
            columnLabel: column.displayName,
            columnMeta: column.tableColumnMeta,
            isNullable: column.isNullable === true,
            foreignKey: column.foreignKey,
            initialInputValue: pendingTypingActivation?.value,
            ...(pendingTypingActivation
              ? { cancelRestoreValue: pendingTypingActivation.cancelRestoreValue }
              : {}),
            selectAllOnFocus: pendingTypingActivation ? false : true,
          },
        } as TextCell & { glideEditorData: unknown }
      }
      return buildTextCell(flags.displayValue, flags, flags.copyValue)
    },
    [
      activeSelectedRowIndex,
      editableColumnKeys,
      gridColumns,
      highlightColumnKey,
      isEditMode,
      isModifiedCell,
      isRowEditing,
      isRowSelected,
    ]
  )

  const getCellContent = useCallback(
    ([colIndex, rowIndex]: Item): GridCell => {
      const row = source.getRow(rowIndex)
      if (!row) {
        // Windowed rows that aren't loaded yet: a flat skeleton (drawn in drawCell).
        return isWindowed
          ? { kind: GridCellKind.Loading, allowOverlay: false }
          : buildTextCell('', classifyCellValue('', ''))
      }
      return buildCellForRow(row, colIndex, rowIndex)
    },
    [buildCellForRow, isWindowed, source]
  )

  /** Windowed `getCellsForSelection`: synchronous, loaded rows only, never fetches. */
  const getCellsForSelection = useCallback(
    (rect: Rectangle): readonly (readonly GridCell[])[] =>
      Array.from({ length: rect.height }, (_, rowOffset) =>
        Array.from({ length: rect.width }, (_, colOffset) =>
          getCellContent([rect.x + colOffset, rect.y + rowOffset])
        )
      ),
    [getCellContent]
  )

  const handleHeaderClicked = useCallback(
    (columnIndex: number) => {
      const column = gridColumns[columnIndex]
      if (!column || !onSortChange) return
      if (column.sortable === false) return
      if (sortColumn !== column.key) {
        onSortChange(column.key, 'ASC')
        return
      }
      if (sortDirection === 'ASC') {
        onSortChange(column.key, 'DESC')
        return
      }
      onSortChange(null, null)
    },
    [gridColumns, onSortChange, sortColumn, sortDirection]
  )

  const handleCellClicked = useCallback(
    (cell: Item, event: CellClickedEventArgs) => {
      const [colIndex, rowIndex] = cell
      const row = source.getRow(rowIndex)
      const column = gridColumns[colIndex]
      if (!row || !column) return
      lastInteractedCellRef.current = { rowIdx: rowIndex, idx: colIndex }

      const isFkAffordanceClick =
        !isListSelectionColumn(column) &&
        column.foreignKey != null &&
        event.bounds != null &&
        (event.localEventX ?? 0) >= event.bounds.width - 28
      const isInfoAffordanceClick =
        isInfoColumn(column) &&
        typeof row.info === 'string' &&
        row.info.length > 0 &&
        event.bounds != null &&
        (event.localEventX ?? 0) >= event.bounds.width - INFO_AFFORDANCE_GUTTER_PX

      if (isFkAffordanceClick) {
        // Clicking the ellipsis on the already-selected cell is Glide's "second click"; without
        // this the overlay editor opens too and floats above the lookup dialog.
        event.preventDefault()
        const runFkLookup = async () => {
          const ok = await changeSelectedCell(rowIndex, colIndex)
          if (ok) {
            selectRow(rowIndex)
            await onFkCellAction?.({
              rowIdx: rowIndex,
              columnKey: column.key,
              rowData: row,
              source: 'grid-pointer',
            })
          }
        }

        void runFkLookup()
        onCellSelectionChange?.({ rowIdx: rowIndex, columnKey: column.key, rowData: row })
        onRowClick?.(row, column.key)
        return
      }

      if (isInfoAffordanceClick) {
        const rect = new DOMRect(
          event.bounds.x,
          event.bounds.y,
          event.bounds.width,
          event.bounds.height
        )
        onInfoCellClick?.(row, rect)
        return
      }

      const run = async () => {
        if (actionPendingRef.current) return
        const guard = onCellClickGuard
          ? await onCellClickGuard({ rowIdx: rowIndex, columnKey: column.key, rowData: row })
          : { proceed: true, targetRowIdx: rowIndex, targetColIdx: colIndex, enableEditor: false }
        if (!guard.proceed) {
          if (guard.restoreFocus) {
            gridRef.current?.selectCell(
              { rowIdx: guard.targetRowIdx, idx: guard.targetColIdx },
              { shouldFocusCell: true, enableEditor: guard.enableEditor }
            )
          }
          return
        }
        const ok = await changeSelectedCell(guard.targetRowIdx, guard.targetColIdx)
        if (ok) {
          selectRow(guard.targetRowIdx)
          const guardedColumn = gridColumns[guard.targetColIdx]
          const guardedRow = source.getRow(guard.targetRowIdx)
          if (guardedColumn && guardedRow) {
            onCellSelectionChange?.({
              rowIdx: guard.targetRowIdx,
              columnKey: guardedColumn.key,
              rowData: guardedRow,
              source: 'grid-pointer',
            })
          }
          if (guard.enableEditor) {
            openListEditor({ rowIdx: guard.targetRowIdx, idx: guard.targetColIdx })
          }
        }
      }
      void run()
      onRowClick?.(row, column.key)
      if (
        isInfoColumn(column) &&
        typeof row.info === 'string' &&
        row.info.length > 0 &&
        event.bounds
      ) {
        const rect = new DOMRect(
          event.bounds.x,
          event.bounds.y,
          event.bounds.width,
          event.bounds.height
        )
        onInfoCellClick?.(row, rect)
      }
    },
    [
      changeSelectedCell,
      gridColumns,
      onCellClickGuard,
      onCellSelectionChange,
      onFkCellAction,
      onInfoCellClick,
      onRowClick,
      openListEditor,
      source,
      selectRow,
    ]
  )

  const handleCellEdited = useCallback(
    (cell: Item, newValue: EditableGridCell) => {
      const [colIndex, rowIndex] = cell
      const column = gridColumns[colIndex]
      if (!column) return
      const next = isDropdownCustomCell(newValue)
        ? isEnumColumn(column) && isDropdownNullSelection(column, newValue.data.value)
          ? null
          : (newValue.data.value ?? null)
        : isMultiSelectCustomCell(newValue)
          ? isSetColumn(column)
            ? serializeSetCellValue(newValue.data.values ?? null)
            : (newValue.data.values ?? null)
          : newValue.kind === GridCellKind.Boolean
            ? newValue.data === true
            : newValue.kind === GridCellKind.Text
              ? newValue.data === '' && newValue.copyData === 'NULL'
                ? null
                : newValue.data
              : undefined
      if (next === undefined) return
      const pendingTypingActivation = pendingTypingActivationRef.current
      const isPendingTypingActivation =
        pendingTypingActivation?.rowIndex === rowIndex &&
        pendingTypingActivation.columnKey === column.key &&
        pendingTypingActivation.value === next
      if (isPendingTypingActivation) {
        pendingTypingActivationRef.current = null
      }
      const baseline = editorSessionBaselineRef.current
      const isActiveEditorSession =
        baseline?.rowIndex === rowIndex && baseline.columnKey === column.key
      const isNoOpCommit =
        !isPendingTypingActivation &&
        isActiveEditorSession &&
        areEditorValuesEqual(baseline.value, next)
      if (!isNoOpCommit) {
        onCellValueChange?.(rowIndex, column.key, next)
      }
      // Windowed grids have no full row array; they rely on onCellValueChange.
      if (onRowsChange && !isWindowed) {
        const nextRows = isNoOpCommit
          ? rowsProp
          : rowsProp.map((row, index) =>
              index === rowIndex ? { ...row, [column.key]: next } : row
            )
        onRowsChange(nextRows, { indexes: [rowIndex], column })
      }
    },
    [gridColumns, isWindowed, onCellValueChange, onRowsChange, rowsProp]
  )

  /**
   * Run a grid action over `ranges` of view positions. Rows that are already
   * loaded are used directly; in windowed mode missing rows are fetched first
   * (in 2,000-row chunks, with progress after 1 s and Cancel for multi-chunk
   * fetches). Nothing is written until every row has loaded. `act` receives a
   * row lookup by view position. Returns true when `act` ran.
   */
  const runRowAction = useCallback(
    async (
      verb: GridRowActionVerb,
      ranges: readonly RowRange[],
      act: (rowAt: (index: number) => GridRow | undefined) => boolean | Promise<boolean>
    ): Promise<boolean> => {
      const merged = mergeRowRanges(ranges, rowCount)
      const missing = isWindowed
        ? merged.filter(([start, end]) => !isRangeLoaded(source, start, end))
        : []
      if (missing.length === 0) {
        return act((index) => source.getRow(index))
      }

      const total = merged.reduce((sum, [start, end]) => sum + (end - start), 0)
      const chunkCount = merged.reduce(
        (sum, [start, end]) => sum + Math.ceil((end - start) / ROW_FETCH_CHUNK),
        0
      )
      const controller = new AbortController()
      actionPendingRef.current = true
      actionAbortRef.current = controller
      const progress = rowActions?.begin(
        verb,
        total,
        chunkCount > 1 ? () => controller.abort() : undefined
      )
      const resolved = new Map<number, GridRow>()
      try {
        let doneBefore = 0
        for (const range of merged) {
          const rows = await resolveRowRange(source, range, {
            signal: controller.signal,
            onProgress: ({ done }) => progress?.update(doneBefore + done),
          })
          if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
          rows.forEach((row, offset) => resolved.set(range[0] + offset, row))
          doneBefore += range[1] - range[0]
          progress?.update(doneBefore)
        }
      } catch (error) {
        progress?.finish()
        actionPendingRef.current = false
        actionAbortRef.current = null
        if (isAbort(error)) return false
        if (isResultsExpired(error)) {
          rowActions?.onExpired()
          return false
        }
        const failure = ROW_ACTION_FAILURES[verb]
        logFrontend('warn', `[grid] ${verb} could not load rows: ${errorText(error)}`)
        showErrorToast(failure.title, failure.message)
        return false
      }
      actionPendingRef.current = false
      actionAbortRef.current = null
      const wasVisible = progress?.finish() ?? false
      const ok = await act((index) => resolved.get(index) ?? source.getRow(index))
      if (ok && wasVisible) {
        const [title, message] = rowActionSuccess(verb, total)
        showSuccessToast(title, message)
      }
      return ok
    },
    [isWindowed, rowActions, rowCount, source]
  )

  /** The copy text of one cell of a resolved row. */
  const cellCopyText = useCallback(
    (row: GridRow, colIndex: number, rowIndex: number): string => {
      const cell = buildCellForRow(row, colIndex, rowIndex)
      return 'copyData' in cell && typeof cell.copyData === 'string' ? cell.copyData : ''
    },
    [buildCellForRow]
  )

  /**
   * Paste one line of values into a row, starting at column `targetCol`. The
   * first editable cell goes through `onCellClipboardEdit`, which saves the row
   * being edited (if any) and starts editing this one; the rest of the line is
   * applied only once that resolved `true`, so no value lands in another row.
   * Read-only cells are skipped, and the line is clipped to the grid.
   */
  const pasteLineIntoRow = useCallback(
    async (
      rowIndex: number,
      row: GridRow,
      targetCol: number,
      line: readonly string[]
    ): Promise<boolean> => {
      const isPasteTarget = (colIndex: number): boolean => {
        const column = gridColumns[colIndex]
        if (!column || isListSelectionColumn(column) || isInfoColumn(column)) return false
        const cell = buildCellForRow(row, colIndex, rowIndex)
        return !('readonly' in cell && cell.readonly === true)
      }
      const first = line.findIndex((_, offset) => isPasteTarget(targetCol + offset))
      if (first < 0) return false
      const started = await onCellClipboardEdit?.({
        rowIdx: rowIndex,
        rowData: row,
        columnKey: gridColumns[targetCol + first].key,
        action: 'paste',
        text: line[first],
      })
      if (started !== true) return false
      line.forEach((text, offset) => {
        const colIndex = targetCol + offset
        if (offset <= first || colIndex >= gridColumns.length) return
        const pasted = pasteTextIntoCell(buildCellForRow(row, colIndex, rowIndex), text)
        if (pasted) handleCellEdited([colIndex, rowIndex], pasted)
      })
      return true
    },
    [buildCellForRow, gridColumns, handleCellEdited, onCellClipboardEdit]
  )

  /**
   * Paste a block at `target`. Rows are edited one at a time, so only the
   * first pasted line is applied, to the target row, and a warning says the
   * other lines were skipped. Glide's own block paste is never used (it would
   * write every line into the row being edited); an unloaded target row is
   * fetched first.
   */
  const handlePaste = useCallback(
    (target: Item, values: readonly (readonly string[])[]) => {
      const [colIndex, rowIndex] = target
      const column = gridColumns[colIndex]
      const line = values[0]
      if (!column || !line?.length || rowIndex < 0 || rowIndex >= rowCount) return false
      if (isListSelectionColumn(column)) return false
      if (actionPendingRef.current) return false
      // Only the result grid is windowed; it pastes only in edit mode.
      if (isWindowed && !source.isLoaded(rowIndex) && isEditMode !== true) return false
      void runRowAction('Pasting', [[rowIndex, rowIndex + 1]], async (rowAt) => {
        const row = rowAt(rowIndex)
        if (!row) return false
        const pasted = await pasteLineIntoRow(rowIndex, row, colIndex, line)
        if (pasted && values.length > 1) {
          showWarningToast(
            'Pasted one row',
            `Rows are edited one at a time, so only the first of ${values.length.toLocaleString()} lines was pasted.`
          )
        }
        return pasted
      })
      return false
    },
    [gridColumns, isEditMode, isWindowed, pasteLineIntoRow, rowCount, runRowAction, source]
  )

  /** Clear the cells of `range`, reading rows through `rowAt`. */
  const clearCellsWithRows = useCallback(
    (range: Rectangle, rowAt: (index: number) => GridRow | undefined) => {
      // Changed rows are copied below; untouched rows keep their identity.
      const nextRows = isWindowed ? [] : rowsProp.slice()
      const changedIndexes = new Set<number>()
      for (let rowIndex = range.y; rowIndex < range.y + range.height; rowIndex += 1) {
        const row = rowAt(rowIndex)
        if (!row) continue
        for (let colIndex = range.x; colIndex < range.x + range.width; colIndex += 1) {
          const column = gridColumns[colIndex]
          if (!column || isInfoColumn(column)) continue
          const next = isEnumColumn(column)
            ? column.isNullable === true
              ? null
              : (column.enumValues[0] ?? '')
            : isSetColumn(column)
              ? column.isNullable === true
                ? null
                : ''
              : column.isNullable === true
                ? null
                : ''
          const baseClearedCell = buildTextCell(
            next == null ? '' : String(next),
            classifyCellValue(next, column.key),
            next == null ? 'NULL' : String(next)
          )
          if (baseClearedCell.kind !== GridCellKind.Text) continue
          const clearedCell: EditableGridCell = isEnumColumn(column)
            ? buildEnumDropdownCell(column, next == null ? null : String(next), true)
            : isSetColumn(column)
              ? buildSetMultiSelectCell(column, next == null ? null : String(next), true)
              : {
                  ...baseClearedCell,
                  readonly: false,
                  allowOverlay: true,
                  data: next == null ? '' : String(next),
                }
          handleCellEdited([colIndex, rowIndex], clearedCell)
          nextRows[rowIndex] = { ...nextRows[rowIndex], [column.key]: next }
          changedIndexes.add(rowIndex)
        }
      }
      // Windowed grids have no full row array; handleCellEdited already reported each cell.
      if (changedIndexes.size > 0 && !isWindowed) {
        onRowsChange?.(nextRows, { indexes: [...changedIndexes], column: gridColumns[range.x] })
      }
    },
    [gridColumns, handleCellEdited, isWindowed, onRowsChange, rowsProp]
  )

  /** Rectangles covered by a selection (row selections become full-width row runs). */
  const selectionRects = useCallback(
    (selection: GridSelection | undefined): Rectangle[] => {
      const rects: Rectangle[] = []
      if (!selection) return rects
      if (selection.current) rects.push(selection.current.range, ...selection.current.rangeStack)
      for (const [start, end] of selectionRowRanges(selection.rows)) {
        rects.push({ x: 0, y: start, width: gridColumns.length, height: end - start })
      }
      for (const colIndex of selection.columns) {
        rects.push({ x: colIndex, y: 0, width: 1, height: rowCount })
      }
      return rects
    },
    [gridColumns.length, rowCount]
  )

  const clearSelection = useCallback(
    (selection: GridSelection): boolean => {
      if (actionPendingRef.current) return false
      const rects = selectionRects(selection)
      if (rects.length === 0) return false
      // In windowed mode only edit mode can change cells: don't fetch rows for a no-op.
      if (isWindowed && isEditMode !== true) return false
      void runRowAction('Clearing', rectRowRanges(rects), (rowAt) => {
        rects.forEach((rect) => clearCellsWithRows(rect, rowAt))
        return true
      })
      return false
    },
    [clearCellsWithRows, isEditMode, isWindowed, runRowAction, selectionRects]
  )

  /**
   * Copy `rects` to the clipboard (Cmd/Ctrl+C in windowed mode, the context
   * menu, and Cut). Unloaded rows are fetched first. `afterWrite` runs with the
   * resolved rows only once the text reached the clipboard (Cut clears there,
   * so a failed fetch or write keeps the cells). Resolves true on success.
   */
  const copyRects = useCallback(
    async (
      rects: Rectangle[],
      verb: 'Copying' | 'Cutting',
      afterWrite?: (rowAt: (index: number) => GridRow | undefined) => void
    ): Promise<boolean> => {
      if (rects.length === 0) return false
      return runRowAction(verb, rectRowRanges(rects), async (rowAt) => {
        const text = rects
          .flatMap((rect) =>
            Array.from({ length: rect.height }, (_, rowOffset) => {
              const rowIndex = rect.y + rowOffset
              const row = rowAt(rowIndex)
              return Array.from({ length: rect.width }, (_, colOffset) =>
                row ? cellCopyText(row, rect.x + colOffset, rowIndex) : ''
              ).join('\t')
            })
          )
          .join('\n')
        if (!text) return false
        try {
          await writeClipboardText(text)
        } catch (error) {
          const failure = ROW_ACTION_FAILURES[verb]
          logFrontend('warn', `Failed to write grid selection to clipboard: ${errorText(error)}`)
          showErrorToast(failure.title, failure.message)
          return false
        }
        afterWrite?.(rowAt)
        return true
      })
    },
    [cellCopyText, runRowAction]
  )

  const copySelectionToClipboard = useCallback(async (): Promise<void> => {
    if (actionPendingRef.current) return
    await copyRects(selectionRects(activeGridSelection), 'Copying')
  }, [activeGridSelection, copyRects, selectionRects])

  const activeSelectionCell = activeGridSelection?.current?.cell

  const pasteClipboardAtSelection = useCallback(async (): Promise<void> => {
    const target = activeSelectionCell
    if (!target || actionPendingRef.current) return
    let text: string
    try {
      text = await readClipboardText()
    } catch (error) {
      logFrontend('warn', `Failed to read grid clipboard text: ${errorText(error)}`)
      showErrorToast(ROW_ACTION_FAILURES.Pasting.title, ROW_ACTION_FAILURES.Pasting.message)
      return
    }
    handlePaste(
      target,
      text.split(/\r?\n/).map((line) => line.split('\t'))
    )
  }, [activeSelectionCell, handlePaste])

  const cutSelectionToClipboard = useCallback(async (): Promise<void> => {
    if (actionPendingRef.current) return
    const rects = selectionRects(activeGridSelection)
    // Cut keeps the selection (and its cells) when the fetch or the clipboard write fails.
    await copyRects(rects, 'Cutting', (rowAt) =>
      rects.forEach((rect) => clearCellsWithRows(rect, rowAt))
    )
  }, [activeGridSelection, clearCellsWithRows, copyRects, selectionRects])

  const provideEditor = useCallback(
    (cell: GridCell) => {
      const editorData =
        cell.kind === GridCellKind.Text
          ? (cell as TextCell & { glideEditorData?: { columnKey?: string } }).glideEditorData
          : undefined
      if (cell.kind === GridCellKind.Custom) return undefined
      const column = editorData?.columnKey
        ? gridColumns.find((candidate) => candidate.key === editorData.columnKey)
        : undefined
      if (!column || editableColumnKeys?.has(column.key) !== true) return undefined
      return (
        getGlideEditor(
          column as GridColumn<unknown>,
          (column.editorType as
            'text' | 'enum' | 'set' | 'datetime' | 'fk' | 'json' | 'none' | undefined) ?? 'text'
        ) ?? undefined
      )
    },
    [editableColumnKeys, gridColumns]
  )

  const handleFinishedEditing = useCallback(() => {
    isEditingCellRef.current = false
    editorSessionBaselineRef.current = null
    pendingTypingActivationRef.current = null
  }, [])

  const cancelActiveEditor = useCallback(() => {
    if (!isEditingCellRef.current) return
    // Glide overlays are absolutely positioned and do not auto-close when commitOnOutsideClick
    // is disabled, so close the active editor before scroll leaves it floating over the wrong cell.
    const canvas = gridRef.current?.element?.querySelector('canvas[data-testid="data-grid-canvas"]')
    canvas?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
      })
    )
    handleFinishedEditing()
  }, [handleFinishedEditing])

  const handleVisibleRegionChanged = useCallback(
    (range: Rectangle) => {
      lastVisibleRegionRef.current = range
      // Windowed mode: the page cache loads the visible rows (plus prefetch).
      source.onVisibleRangeChange?.([range.y, range.y + range.height])
      cancelActiveEditor()
      const scrollCell = clampScrollCell(
        { scrollRow: range.y, scrollCol: range.x },
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER
      )

      if (isSameScrollCell(pendingInitialScrollRestoreRef.current, scrollCell)) {
        pendingInitialScrollRestoreRef.current = null
        suppressScrollPersistenceRef.current = false
        return
      }

      if (suppressScrollPersistenceRef.current) {
        // The grid rendered at a different position than the pending restore target.
        // This happens when the initial rAF scroll fired before the DataEditor was
        // ready (e.g. ResizeObserver had not yet reported a size). Retry now that
        // the grid is actually rendering visible content.
        const pending = pendingInitialScrollRestoreRef.current
        if (pending) {
          requestAnimationFrame(() => {
            if (isSameScrollCell(pendingInitialScrollRestoreRef.current, pending)) {
              gridRef.current?.scrollToCell({ rowIdx: pending.scrollRow, idx: pending.scrollCol })
            }
          })
        }
        return
      }

      pendingInitialScrollRestoreRef.current = null
      lastReportedScrollCellRef.current = scrollCell
      onScrollCellChange?.(scrollCell.scrollRow, scrollCell.scrollCol)
    },
    [cancelActiveEditor, onScrollCellChange, source]
  )

  // Windowed mode: repaint only the cells of newly loaded rows that are on screen.
  const gridColumnCount = gridColumns.length
  useEffect(() => {
    if (!source.subscribe) return undefined
    return source.subscribe(([start, end], info) => {
      const region = lastVisibleRegionRef.current
      // A re-seed dropped every page; the visible region may not change (and
      // so not be reported again), so ask for its rows now.
      if (info?.reseeded && region) {
        source.onVisibleRangeChange?.([region.y, region.y + region.height])
      }
      const from = Math.max(start, region ? region.y : start)
      const to = Math.min(
        end,
        region ? region.y + region.height : start + VISIBLE_REPAINT_FALLBACK_ROWS
      )
      if (to <= from) return
      const cells: Array<readonly [number, number]> = []
      for (let row = from; row < to; row++) {
        for (let col = 0; col < gridColumnCount; col++) cells.push([col, row])
      }
      gridRef.current?.updateCells?.(cells)
    })
  }, [gridColumnCount, source])

  const handleCellActivatedForEditing = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell
      const column = gridColumns[colIndex]
      const row = source.getRow(rowIndex)
      if (column && row) {
        editorSessionBaselineRef.current = {
          rowIndex,
          columnKey: column.key,
          value: normalizeEditorValue(resolveEditorBaselineValue(row, column.key, editState)),
        }
      } else {
        editorSessionBaselineRef.current = null
      }
      isEditingCellRef.current = true
    },
    [editState, gridColumns, source]
  )

  const handleCellDoubleClicked = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell
      const row = source.getRow(rowIndex)
      const column = gridColumns[colIndex]
      if (!row || !column) return
      onCellDoubleClick?.(row, column.key)
      onRowDoubleClicked?.(row)
    },
    [gridColumns, onCellDoubleClick, onRowDoubleClicked, source]
  )

  const gridSelectionCell = gridSelection?.current?.cell

  const triggerFkLookupFromSelection = useCallback(
    (event: { preventDefault: () => void }) => {
      const pos =
        selectedCellPosition ??
        (gridSelectionCell
          ? {
              idx: gridSelectionCell[0],
              rowIdx: gridSelectionCell[1],
            }
          : lastInteractedCellRef.current)
      if (!pos) return false
      const row = source.getRow(pos.rowIdx)
      const column = gridColumns[pos.idx]
      if (!row || !column?.foreignKey || isListSelectionColumn(column)) return false
      event.preventDefault()
      void onFkCellAction?.({
        rowIdx: pos.rowIdx,
        columnKey: column.key,
        rowData: row,
        source: 'keyboard',
      })
      return true
    },
    [gridColumns, gridSelectionCell, onFkCellAction, source, selectedCellPosition]
  )

  const handleKeyDown = useCallback<(event: GlideKeyDownEvent) => void>(
    (event) => {
      if (rowCount === 0) return
      const isShortcut = event.metaKey || event.ctrlKey
      if (event.key === 'Escape' && actionPendingRef.current) {
        // Escape cancels a fetch-first action; nothing has been written yet.
        event.preventDefault()
        event.cancel?.()
        actionAbortRef.current?.abort()
        return
      }
      if (isWindowed && isShortcut && event.key.toLowerCase() === 'c') {
        // Glide's own copy is off in windowed mode; use the async copy path.
        event.preventDefault()
        event.cancel?.()
        void copySelectionToClipboard()
        return
      }
      if (isShortcut && event.key.toLowerCase() === 'x') {
        event.preventDefault()
        event.cancel?.()
        void cutSelectionToClipboard()
        return
      }

      const currentCell = gridSelectionCell
        ? {
            idx: gridSelectionCell[0],
            rowIdx: gridSelectionCell[1],
          }
        : selectedCellPosition

      const moveSelection = (delta: -1 | 1) => {
        const currentRow = currentCell?.rowIdx ?? activeSelectedRowIndex ?? 0
        const nextRow = Math.max(0, Math.min(rowCount - 1, currentRow + delta))
        const nextCol = currentCell?.idx ?? 0

        if (nextRow === currentRow && currentCell) {
          if (activeSelectedRowIndex !== nextRow) {
            selectRow(nextRow)
          }
          gridRef.current?.selectCell(
            { rowIdx: nextRow, idx: nextCol },
            { shouldFocusCell: true, enableEditor: false }
          )
          return
        }

        const nextRowData = source.getRow(nextRow)
        const nextColumn = gridColumns[nextCol]
        if (!nextRowData || !nextColumn) return

        const applySelection = async () => {
          if (runCellClickGuardOnKeyboardSelection && onCellClickGuard) {
            const guard = await onCellClickGuard({
              rowIdx: nextRow,
              columnKey: nextColumn.key,
              rowData: nextRowData,
              source: 'keyboard',
            })

            if (!guard.proceed) {
              if (guard.restoreFocus) {
                gridRef.current?.selectCell(
                  { rowIdx: guard.targetRowIdx, idx: guard.targetColIdx },
                  {
                    shouldFocusCell: true,
                    enableEditor: guard.enableEditor,
                  }
                )
              }
              return
            }

            const ok = await changeSelectedCell(guard.targetRowIdx, guard.targetColIdx)
            if (!ok) return

            selectRow(guard.targetRowIdx)
            gridRef.current?.selectCell(
              { rowIdx: guard.targetRowIdx, idx: guard.targetColIdx },
              {
                shouldFocusCell: true,
                enableEditor: guard.enableEditor,
              }
            )
            onCellSelectionChange?.({
              rowIdx: guard.targetRowIdx,
              columnKey: gridColumns[guard.targetColIdx]?.key ?? nextColumn.key,
              rowData: source.getRow(guard.targetRowIdx) ?? nextRowData,
              source: 'keyboard',
            })
            return
          }

          const ok = await changeSelectedCell(nextRow, nextCol)
          if (!ok) return
          selectRow(nextRow)
          gridRef.current?.selectCell(
            { rowIdx: nextRow, idx: nextCol },
            { shouldFocusCell: true, enableEditor: false }
          )
          onCellSelectionChange?.({
            rowIdx: nextRow,
            columnKey: nextColumn.key,
            rowData: nextRowData,
            source: 'keyboard',
          })
        }

        void applySelection()
      }

      const moveSelectionHorizontal = (delta: -1 | 1) => {
        const currentRow = currentCell?.rowIdx ?? activeSelectedRowIndex ?? 0
        const currentCol = currentCell?.idx ?? 0
        const nextCol = Math.max(0, Math.min(gridColumns.length - 1, currentCol + delta))

        if (nextCol !== currentCol) {
          void changeSelectedCell(currentRow, nextCol)
        }

        gridRef.current?.selectCell(
          { rowIdx: currentRow, idx: nextCol },
          { shouldFocusCell: true, enableEditor: false }
        )
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        event.cancel?.()
        moveSelection(1)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        event.cancel?.()
        moveSelection(-1)
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        event.cancel?.()
        moveSelectionHorizontal(1)
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        event.cancel?.()
        moveSelectionHorizontal(-1)
        return
      }
      if (isTypingActivationKey(event) && currentCell) {
        if (actionPendingRef.current) {
          // Edits are blocked while an action fetches rows.
          event.preventDefault()
          event.cancel?.()
          return
        }
        const currentRow = source.getRow(currentCell.rowIdx)
        const currentColumn = gridColumns[currentCell.idx]
        if (!currentRow || !currentColumn) return
        if (isListSelectionColumn(currentColumn)) {
          event.preventDefault?.()
          event.cancel?.()
          return
        }
        const typedValue = event.key
        const cancelRestoreValue = resolveEditorBaselineValue(
          currentRow,
          currentColumn.key,
          editState
        )

        const startEditor = async () => {
          const guard = onCellClickGuard
            ? await onCellClickGuard({
                rowIdx: currentCell.rowIdx,
                columnKey: currentColumn.key,
                rowData: currentRow,
                source: 'keyboard-typing',
              })
            : {
                proceed: true,
                targetRowIdx: currentCell.rowIdx,
                targetColIdx: currentCell.idx,
                enableEditor: true,
              }

          if (!guard.proceed) {
            if (guard.restoreFocus) {
              gridRef.current?.selectCell(
                { rowIdx: guard.targetRowIdx, idx: guard.targetColIdx },
                { shouldFocusCell: true, enableEditor: guard.enableEditor }
              )
            }
            return
          }

          const ok = await changeSelectedCell(guard.targetRowIdx, guard.targetColIdx)
          if (!ok) return
          selectRow(guard.targetRowIdx)
          const targetColumn = gridColumns[guard.targetColIdx]
          if (
            guard.enableEditor &&
            targetColumn &&
            editableColumnKeys?.has(targetColumn.key) === true
          ) {
            pendingTypingActivationRef.current = {
              rowIndex: guard.targetRowIdx,
              columnKey: targetColumn.key,
              value: typedValue,
              cancelRestoreValue,
            }
          }
          gridRef.current?.selectCell(
            { rowIdx: guard.targetRowIdx, idx: guard.targetColIdx },
            { shouldFocusCell: true, enableEditor: guard.enableEditor }
          )
        }

        event.preventDefault()
        event.cancel?.()
        void startEditor()
        return
      }
      if (event.key === 'Enter' && currentCell) {
        const currentColumn = gridColumns[currentCell.idx]
        if (
          isListSelectionColumn(currentColumn) &&
          isEditableColumn(currentColumn, isEditMode, editableColumnKeys)
        ) {
          event.preventDefault()
          event.cancel?.()
          openListEditor(currentCell)
          return
        }
      }
      if (event.key === 'Enter' && activeSelectedRowIndex != null) {
        const row = source.getRow(activeSelectedRowIndex)
        if (row) {
          event.preventDefault()
          onRowDoubleClicked?.(row)
        }
      }
      if (isActive && event.key === 'F4') {
        event.cancel?.()
        triggerFkLookupFromSelection(event)
      }
    },
    [
      activeSelectedRowIndex,
      copySelectionToClipboard,
      cutSelectionToClipboard,
      isWindowed,
      rowCount,
      gridColumns,
      editableColumnKeys,
      isEditMode,
      onRowDoubleClicked,
      onCellClickGuard,
      onCellSelectionChange,
      source,
      runCellClickGuardOnKeyboardSelection,
      selectedCellPosition,
      selectRow,
      changeSelectedCell,
      editState,
      gridSelectionCell,
      isActive,
      triggerFkLookupFromSelection,
      openListEditor,
    ]
  )

  useEffect(() => {
    const isInteractiveElement = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      const tag = target.tagName.toLowerCase()
      return (
        ['button', 'input', 'select', 'textarea', 'a'].includes(tag) || target.isContentEditable
      )
    }

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (!isActive) return
      if (isInteractiveElement(event.target)) {
        return
      }

      const currentDocumentCell =
        selectedCellPosition ??
        (gridSelection?.current
          ? { idx: gridSelection.current.cell[0], rowIdx: gridSelection.current.cell[1] }
          : lastInteractedCellRef.current)
      if (event.key === 'Enter' && currentDocumentCell) {
        const column = gridColumns[currentDocumentCell.idx]
        if (
          isListSelectionColumn(column) &&
          isEditableColumn(column, isEditMode, editableColumnKeys)
        ) {
          event.preventDefault()
          openListEditor(currentDocumentCell)
          return
        }
      }

      if (event.defaultPrevented) return
      if (event.key !== 'F4') return

      triggerFkLookupFromSelection(event)
    }

    document.addEventListener('keydown', handleDocumentKeyDown)
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown)
    }
  }, [
    editableColumnKeys,
    gridColumns,
    gridSelection,
    isActive,
    isEditMode,
    openListEditor,
    selectedCellPosition,
    triggerFkLookupFromSelection,
  ])

  const handleSelectionChange = useCallback(
    (nextSelection: GridSelection) => {
      let selection = nextSelection
      if (isWindowed) {
        // A loading row's checkbox is disabled: ignore a single-row check on it.
        // Range and header select-all checks are kept (they are view ranges).
        const previousRows = gridSelection?.rows ?? CompactSelection.empty()
        if (selection.rows.length === previousRows.length + 1) {
          const added = findAddedIndex(selection.rows, previousRows)
          if (added !== undefined && !source.isLoaded(added)) {
            selection = { ...selection, rows: previousRows }
          }
        }
      }
      setGridSelection(selection)
      if (selection.current) {
        lastInteractedCellRef.current = {
          idx: selection.current.cell[0],
          rowIdx: selection.current.cell[1],
        }
        const column = gridColumns[selection.current.cell[0]]
        lastSelectedListCellRef.current = isListSelectionColumn(column)
          ? { idx: selection.current.cell[0], rowIdx: selection.current.cell[1] }
          : null
      }
      if (isWindowed && onRowMarkerRangesChange) {
        const ranges = selectionRowRanges(selection.rows)
        const key = JSON.stringify(ranges)
        if (key !== prevMarkedRangesKeyRef.current) {
          prevMarkedRangesKeyRef.current = key
          onRowMarkerRangesChange(ranges)
        }
      } else if (onRowMarkersChange) {
        const selectedRowIndices = [...selection.rows]
        const prev = prevMarkedRowsRef.current
        const rowsChanged =
          selectedRowIndices.length !== prev.length ||
          selectedRowIndices.some((value, i) => value !== prev[i])
        if (rowsChanged) {
          prevMarkedRowsRef.current = selectedRowIndices
          const selected = selectedRowIndices
            .map((rowIndex) => source.getRow(rowIndex))
            .filter((row): row is GridRow => row != null)
          onRowMarkersChange(selected)
        }
      }
    },
    [gridColumns, gridSelection, isWindowed, onRowMarkerRangesChange, onRowMarkersChange, source]
  )

  const handleContextMenu = useCallback<React.MouseEventHandler<HTMLDivElement>>((event) => {
    event.preventDefault()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      portalRoot: getContextMenuPortalRoot(event.target as Element | null),
    })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  // Clamp the menu inside its portal root after it renders so it stays attached to the pointer
  // and never overflows the viewport / dialog edge.
  useLayoutEffect(() => {
    if (!contextMenu || !clipboardMenuRef.current) return
    const el = clipboardMenuRef.current
    const rect = el.getBoundingClientRect()
    const pos = positionContextMenuInPortal(
      contextMenu.portalRoot,
      contextMenu.x,
      contextMenu.y,
      rect.width,
      rect.height
    )
    el.style.left = `${pos.x}px`
    el.style.top = `${pos.y}px`
  }, [contextMenu])

  useEffect(() => {
    if (isActive) return
    queueMicrotask(closeContextMenu)
    cancelActiveEditor()
  }, [cancelActiveEditor, closeContextMenu, isActive])

  useEffect(() => {
    if (!contextMenu) return
    const onPointerDown = (): void => closeContextMenu()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeContextMenu()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [closeContextMenu, contextMenu])

  const handleColumnResize = useCallback(
    (columnIndex: number, width: number) => {
      const column = gridColumns[columnIndex]
      if (!column) return
      if (!onColumnResize) {
        setInternalColumnWidths((current) =>
          current[column.key] === width ? current : { ...current, [column.key]: width }
        )
      }
      onColumnResize?.(column.key, width)
    },
    [gridColumns, onColumnResize]
  )

  const drawCell = useCallback<DrawCellCallback>(
    (args, drawContent) => {
      const row = source.getRow(args.row)
      const column = gridColumns[args.col]
      if (row === undefined && isWindowed) {
        // Not loaded yet: a flat --skeleton-base bar (never like NULL text).
        drawSkeletonCell(
          args.ctx,
          args.rect,
          skeletonColor,
          args.theme.cellHorizontalPadding,
          parseFloat(args.theme.editorFontSize) || SKELETON_FALLBACK_LINE_PX
        )
        return
      }
      const hasInfoAffordance =
        column != null &&
        isInfoColumn(column) &&
        typeof row?.info === 'string' &&
        row.info.length > 0
      const isSelected = row != null && (activeSelectedRowIndex === args.row || isRowSelected(row))
      if (column?.key === highlightColumnKey) {
        drawHighlightedColumnBackground(args.ctx, args.rect, args.theme.bgSearchResult)
      }
      if (isSelected) {
        drawHighlightedColumnBackground(args.ctx, args.rect, args.theme.bgBubbleSelected)
        drawSelectedRowAccent(args.ctx, args.rect, args.theme.accentColor)
      }
      if (row != null && isRowEditing(row)) {
        drawHighlightedColumnBackground(args.ctx, args.rect, args.theme.bgHeaderHovered)
      }
      if (hasInfoAffordance) {
        args.ctx.save()
        args.ctx.beginPath()
        args.ctx.rect(
          args.rect.x,
          args.rect.y,
          Math.max(0, args.rect.width - INFO_AFFORDANCE_GUTTER_PX),
          args.rect.height
        )
        args.ctx.clip()
        drawContent()
        args.ctx.restore()
      } else {
        drawContent()
      }
      if (column && row && isModifiedCell?.(row, column.key)) {
        drawModifiedCellIndicator(args.ctx, args.rect, args.theme.accentColor, false)
      }
      if (hasInfoAffordance) {
        drawInfoAffordance(args.ctx, args.rect, args.theme.linkColor)
      }
      if (column?.foreignKey && row && !isListSelectionColumn(column)) {
        drawFkEllipsis(args.ctx, args.rect, args.theme.linkColor)
      }
    },
    [
      activeSelectedRowIndex,
      gridColumns,
      highlightColumnKey,
      isModifiedCell,
      isRowEditing,
      isRowSelected,
      isWindowed,
      skeletonColor,
      source,
    ]
  )

  const drawHeader = useCallback<DrawHeaderCallback>(
    (args, drawContent) => {
      const column = gridColumns[args.columnIndex]
      if (!column) {
        drawContent()
        return
      }
      drawCustomHeader(
        args.ctx,
        args,
        {
          sortDirection: sortColumns.find((sort) => sort.columnKey === column.key)?.direction,
          isReadOnly: column.editable !== true && column.blobViewerEditable !== true,
          hasFkLink: column.foreignKey != null && !isListSelectionColumn(column),
          isHighlighted: highlightColumnKey === column.key,
        },
        args.theme
      )
    },
    [gridColumns, highlightColumnKey, sortColumns]
  )

  return (
    <div onContextMenu={handleContextMenu} style={GRID_WELL_STYLE}>
      <GlideDataGrid
        ref={gridRef}
        columns={glideColumns}
        rows={isWindowed ? EMPTY_GRID_ROWS : rowsProp}
        rowCount={isWindowed ? rowCount : undefined}
        getCellContent={getCellContent}
        getCellsForSelection={isWindowed ? getCellsForSelection : undefined}
        keybindings={isWindowed ? WINDOWED_KEYBINDINGS : undefined}
        customRenderers={CUSTOM_RENDERERS}
        onColumnResize={handleColumnResize}
        onHeaderClicked={handleHeaderClicked}
        onCellClicked={handleCellClicked}
        onCellEdited={handleCellEdited}
        onDelete={clearSelection}
        provideEditor={provideEditor}
        onPaste={handlePaste}
        onCellDoubleClicked={handleCellDoubleClicked}
        onCellActivated={handleCellActivatedForEditing}
        onFinishedEditing={handleFinishedEditing}
        onCellContextMenu={handleCellClicked}
        onVisibleRegionChanged={handleVisibleRegionChanged}
        selection={activeGridSelection}
        onSelectionChange={handleSelectionChange}
        rowMarkers={rowMarkers}
        drawCell={drawCell}
        drawHeader={drawHeader}
        onKeyDown={handleKeyDown}
        aria-label={testId ? `${testId} data grid` : 'Data grid'}
        data-testid={testId}
      />
      {contextMenu
        ? createPortal(
            <div
              ref={clipboardMenuRef}
              className="ui-context-menu"
              role="menu"
              data-testid={testId ? `${testId}-clipboard-menu` : 'grid-clipboard-menu'}
              style={{
                left: contextMenu.x,
                top: contextMenu.y,
                position: getContextMenuPositionMode(contextMenu.portalRoot),
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="ui-context-menu__item"
                role="menuitem"
                onClick={() => {
                  void copySelectionToClipboard()
                  closeContextMenu()
                }}
              >
                <CopySimple
                  className="ui-context-menu__icon"
                  size={18}
                  weight="regular"
                  aria-hidden
                />
                <span>Copy</span>
              </button>
              <button
                type="button"
                className="ui-context-menu__item"
                role="menuitem"
                onClick={() => {
                  void cutSelectionToClipboard()
                  closeContextMenu()
                }}
              >
                <Scissors
                  className="ui-context-menu__icon"
                  size={18}
                  weight="regular"
                  aria-hidden
                />
                <span>Cut</span>
              </button>
              <button
                type="button"
                className="ui-context-menu__item"
                role="menuitem"
                onClick={() => {
                  void pasteClipboardAtSelection()
                  closeContextMenu()
                }}
              >
                <ClipboardText
                  className="ui-context-menu__icon"
                  size={18}
                  weight="regular"
                  aria-hidden
                />
                <span>Paste</span>
              </button>
            </div>,
            contextMenu.portalRoot
          )
        : null}
    </div>
  )
}

export const CanvasBaseGridView = forwardRef(CanvasBaseGridViewInner)
