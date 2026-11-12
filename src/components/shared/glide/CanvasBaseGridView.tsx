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
import {
  AUTO_SIZE_SAMPLE_LIMIT,
  getDefaultColumnWidth,
  HEADER_ICON_WIDTH_PX,
} from '../../../lib/grid-column-style'
import type {
  BaseGridViewProps,
  CellClickGuardArgs,
  CellClickGuardResult,
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
  drawForeignKeyEllipsis,
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
import type { GridCellPosition, GridColumn, GridHandle, GridSortColumn } from './glide-grid-types'
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
import { Button } from '../../common/Button'
import { toErrorMessage } from '../../../lib/error-message'

const LAST_ASCII_CONTROL_CODE = 0x1f
const FOREIGN_KEY_AFFORDANCE_WIDTH_PX = 28

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
  for (let index = 0; index <= LAST_ASCII_CONTROL_CODE; index += 1) {
    const candidate = String.fromCharCode(index)
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

const ROW_ACTION_SUCCESS: Record<GridRowActionVerb, (rows: string) => [string, string]> = {
  Copying: (rows) => ['Copied', `${rows} copied to clipboard.`],
  Cutting: (rows) => ['Cut', `${rows} cut.`],
  Clearing: (rows) => ['Cleared', `${rows} cleared.`],
  Pasting: (rows) => ['Pasted', `${rows} updated.`],
}

function rowActionSuccess(verb: GridRowActionVerb, count: number): [string, string] {
  const rows = `${formatCount(count)} ${count === 1 ? 'row' : 'rows'}`
  return ROW_ACTION_SUCCESS[verb](rows)
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
  for (const index of [...selection].sort((left, right) => left - right)) {
    const current = ranges[ranges.length - 1]
    const extendsCurrentRange = current !== undefined && current[1] === index
    if (extendsCurrentRange) {
      current[1] = index + 1
      continue
    }
    ranges.push([index, index + 1])
  }
  return ranges
}

/** Merge half-open ranges (clamped to `[0, rowCount)`), sorted and non-overlapping. */
function mergeRowRanges(ranges: readonly RowRange[], rowCount: number): Array<[number, number]> {
  const sorted = ranges
    .map(([start, end]): [number, number] => [Math.max(0, start), Math.min(rowCount, end)])
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0])
  const merged: Array<[number, number]> = []
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1]
    const overlapsLastRange = last !== undefined && start <= last[1]
    if (overlapsLastRange) {
      last[1] = Math.max(last[1], end)
      continue
    }
    merged.push([start, end])
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

/** `results_expired` failures route to the "Results expired" block, not a toast. */
function isResultsExpired(error: unknown): boolean {
  return toErrorMessage(error).includes('results_expired')
}

function resolveConfiguredColumnWidth(
  column: GridColumnDescriptor,
  rows: readonly GridRow[],
  autoSizeConfig: CanvasBaseGridViewProps['autoSizeConfig']
): number | undefined {
  if (typeof column.width === 'number') return column.width
  if (autoSizeConfig?.enabled !== true) return undefined
  return autoSizeConfig.computeWidth(column, rows)
}

function toGridColumn(
  column: GridColumnDescriptor,
  rows: readonly GridRow[],
  autoSizeConfig: CanvasBaseGridViewProps['autoSizeConfig']
): GridColumn<GridRow> {
  const computedWidth = resolveConfiguredColumnWidth(column, rows, autoSizeConfig)
  return {
    key: column.key,
    name: column.displayName,
    dataType: column.dataType,
    width:
      computedWidth ??
      (column.editable
        ? getDefaultColumnWidth(column.dataType)
        : getDefaultColumnWidth(column.dataType) + HEADER_ICON_WIDTH_PX),
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
      allowedValues: allowedValues,
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

function clampScrollCell(scrollCell: ScrollCell, maxRow: number, maxColumn: number): ScrollCell {
  return {
    scrollRow: Math.max(0, Math.min(maxRow, Math.floor(scrollCell.scrollRow))),
    scrollCol: Math.max(0, Math.min(maxColumn, Math.floor(scrollCell.scrollCol))),
  }
}

function isSameScrollCell(left: ScrollCell | null, right: ScrollCell): boolean {
  return left?.scrollRow === right.scrollRow && left.scrollCol === right.scrollCol
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

interface GridBehaviourFlags {
  rowMarkers: NonNullable<CanvasBaseGridViewProps['rowMarkers']>
  showInfoColumn: boolean
  isActive: boolean
  runCellClickGuardOnKeyboardSelection: boolean
}

function resolveGridBehaviourFlags(props: CanvasBaseGridViewProps): GridBehaviourFlags {
  return {
    rowMarkers: props.rowMarkers ?? 'none',
    showInfoColumn: props.showInfoColumn ?? false,
    isActive: props.isActive ?? true,
    runCellClickGuardOnKeyboardSelection: props.runCellClickGuardOnKeyboardSelection ?? false,
  }
}

function currentSelectionCell(selection: GridSelection | undefined): Item | undefined {
  return selection?.current?.cell
}

function toCellPosition(cell: Item | undefined): GridCellPosition | null {
  if (!cell) return null
  return { idx: cell[0], rowIdx: cell[1] }
}

function gridAriaLabel(testId: string | undefined): string {
  return testId ? `${testId} data grid` : 'Data grid'
}

function clipboardMenuTestId(testId: string | undefined): string {
  return testId ? `${testId}-clipboard-menu` : 'grid-clipboard-menu'
}

function nullableCellString(value: unknown): string | null {
  return value == null ? null : String(value)
}

function buildEmptyTextCell(): GridCell {
  return buildTextCell('', classifyCellValue('', ''))
}

function buildCheckboxCell(rawValue: unknown): BooleanCell {
  return {
    kind: GridCellKind.Boolean,
    data: rawValue === true,
    allowOverlay: false,
    readonly: false,
  }
}

function matchingTypingActivation(
  pending: PendingTypingActivation | null,
  rowIndex: number,
  columnKey: string
): PendingTypingActivation | null {
  const isForThisCell = pending?.rowIndex === rowIndex && pending.columnKey === columnKey
  return isForThisCell ? pending : null
}

interface DataCellInput {
  row: GridRow
  rowIndex: number
  column: GridColumn<GridRow>
  flags: ReturnType<typeof classifyCellValue>
  editable: boolean
  pendingTypingActivation: PendingTypingActivation | null
}

function buildEditableTextCell(input: DataCellInput): GridCell {
  const { row, rowIndex, column, flags } = input
  const rawValue = row[column.key]
  const baseCell = flags.isNull
    ? buildNullCell(flags.copyValue)
    : buildTextCell(flags.displayValue, flags, flags.copyValue)
  const activation = matchingTypingActivation(input.pendingTypingActivation, rowIndex, column.key)
  const cancelRestore = activation ? { cancelRestoreValue: activation.cancelRestoreValue } : {}
  return {
    ...baseCell,
    readonly: false,
    allowOverlay: true,
    data: nullableCellString(rawValue) ?? '',
    glideEditorData: {
      row: row,
      columnKey: column.key,
      columnLabel: column.displayName,
      columnMeta: column.tableColumnMeta,
      isNullable: column.isNullable === true,
      foreignKey: column.foreignKey,
      initialInputValue: activation?.value,
      ...cancelRestore,
      selectAllOnFocus: activation === null,
    },
  } as TextCell & { glideEditorData: unknown }
}

function buildDataCell(input: DataCellInput): GridCell {
  const { row, column, flags, editable } = input
  const rawValue = row[column.key]
  if (flags.isBlob) return buildBlobCell(flags.displayValue, flags.copyValue)
  if (flags.isNull && !editable) return buildNullCell(flags.copyValue)
  if (isEnumColumn(column)) {
    return buildEnumDropdownCell(column, nullableCellString(rawValue), editable)
  }
  if (isSetColumn(column)) {
    return buildSetMultiSelectCell(column, nullableCellString(rawValue), editable)
  }
  if (editable) return buildEditableTextCell(input)
  return buildTextCell(flags.displayValue, flags, flags.copyValue)
}

function isReadOnlyInEditMode(
  column: GridColumn<GridRow>,
  isEditMode: boolean | undefined,
  editableColumnKeys: ReadonlySet<string> | undefined
): boolean {
  return isEditMode === true && editableColumnKeys?.has(column.key) !== true
}

function hasInfoText(column: GridColumn<GridRow> | undefined, row: GridRow | undefined): boolean {
  if (!column || !isInfoColumn(column)) return false
  return typeof row?.info === 'string' && row.info.length > 0
}

function isPointerInTrailingGutter(event: CellClickedEventArgs, gutterWidth: number): boolean {
  return (event.localEventX ?? 0) >= event.bounds.width - gutterWidth
}

function isForeignKeyAffordanceClick(
  column: GridColumn<GridRow>,
  event: CellClickedEventArgs
): boolean {
  if (isListSelectionColumn(column) || column.foreignKey == null) return false
  return event.bounds != null && isPointerInTrailingGutter(event, FOREIGN_KEY_AFFORDANCE_WIDTH_PX)
}

function isInfoAffordanceClick(
  column: GridColumn<GridRow>,
  row: GridRow,
  event: CellClickedEventArgs
): boolean {
  if (!hasInfoText(column, row)) return false
  return event.bounds != null && isPointerInTrailingGutter(event, INFO_AFFORDANCE_GUTTER_PX)
}

function boundsToDomRect(bounds: Rectangle): DOMRect {
  return new DOMRect(bounds.x, bounds.y, bounds.width, bounds.height)
}

function proceedWithoutGuard(
  target: GridCellPosition,
  enableEditor: boolean
): CellClickGuardResult {
  return {
    proceed: true,
    targetRowIdx: target.rowIdx,
    targetColIdx: target.idx,
    enableEditor: enableEditor,
  }
}

function guardTargetCell(guard: CellClickGuardResult): GridCellPosition {
  return { rowIdx: guard.targetRowIdx, idx: guard.targetColIdx }
}

function selectGuardTarget(grid: GridHandle | null, guard: CellClickGuardResult): void {
  grid?.selectCell(guardTargetCell(guard), {
    shouldFocusCell: true,
    enableEditor: guard.enableEditor,
  })
}

function restoreFocusAfterRejectedGuard(
  grid: GridHandle | null,
  guard: CellClickGuardResult
): void {
  if (guard.restoreFocus) selectGuardTarget(grid, guard)
}

function resolveDropdownEditValue(column: GridColumn<GridRow>, cell: DropdownCellType): unknown {
  const selectedValue = cell.data.value
  if (isEnumColumn(column) && isDropdownNullSelection(column, selectedValue)) return null
  return selectedValue ?? null
}

function resolveMultiSelectEditValue(
  column: GridColumn<GridRow>,
  cell: MultiSelectCellType
): unknown {
  const selectedValues = cell.data.values ?? null
  if (isSetColumn(column)) return serializeSetCellValue(selectedValues)
  return selectedValues
}

function resolveTextEditValue(cell: TextCell): string | null {
  const isClearedToNull = cell.data === '' && cell.copyData === 'NULL'
  return isClearedToNull ? null : cell.data
}

function resolveEditedCellValue(column: GridColumn<GridRow>, cell: EditableGridCell): unknown {
  if (isDropdownCustomCell(cell)) return resolveDropdownEditValue(column, cell)
  if (isMultiSelectCustomCell(cell)) return resolveMultiSelectEditValue(column, cell)
  if (cell.kind === GridCellKind.Boolean) return cell.data === true
  if (cell.kind === GridCellKind.Text) return resolveTextEditValue(cell)
  return undefined
}

interface EditedCellIdentity {
  rowIndex: number
  columnKey: string
  value: unknown
}

function isPendingTypingActivationCommit(
  pending: PendingTypingActivation | null,
  edit: EditedCellIdentity
): boolean {
  const isSameCell = pending?.rowIndex === edit.rowIndex && pending.columnKey === edit.columnKey
  return isSameCell && pending.value === edit.value
}

function isUnchangedEditorCommit(
  baseline: EditorSessionBaseline | null,
  edit: EditedCellIdentity
): boolean {
  const isSameCell = baseline?.rowIndex === edit.rowIndex && baseline.columnKey === edit.columnKey
  return isSameCell && areEditorValuesEqual(baseline.value, edit.value)
}

function withCellValue(rows: GridRow[], edit: EditedCellIdentity): GridRow[] {
  return rows.map((row, index) =>
    index === edit.rowIndex ? { ...row, [edit.columnKey]: edit.value } : row
  )
}

function clearedValueFor(column: GridColumn<GridRow>): string | null {
  if (column.isNullable === true) return null
  if (isEnumColumn(column)) return column.enumValues[0] ?? ''
  return ''
}

function buildClearedCell(
  column: GridColumn<GridRow>,
  clearedValue: string | null
): EditableGridCell | undefined {
  if (isEnumColumn(column)) return buildEnumDropdownCell(column, clearedValue, true)
  if (isSetColumn(column)) return buildSetMultiSelectCell(column, clearedValue, true)
  const text = clearedValue ?? ''
  const baseCell = buildTextCell(
    text,
    classifyCellValue(clearedValue, column.key),
    clearedValue ?? 'NULL'
  )
  if (baseCell.kind !== GridCellKind.Text) return undefined
  return { ...baseCell, readonly: false, allowOverlay: true, data: text }
}

function isClearableColumn(column: GridColumn<GridRow> | undefined): column is GridColumn<GridRow> {
  return column !== undefined && !isInfoColumn(column)
}

type RowProgress = ReturnType<GridRowActions['begin']>

interface RowRangeLoadRequest {
  source: GridRowSource<GridRow>
  ranges: Array<[number, number]>
  signal: AbortSignal
  progress: RowProgress | undefined
}

async function loadRowRanges(request: RowRangeLoadRequest): Promise<Map<number, GridRow>> {
  const resolved = new Map<number, GridRow>()
  let doneBefore = 0
  for (const range of request.ranges) {
    const doneBeforeRange = doneBefore
    const rows = await resolveRowRange(request.source, range, {
      signal: request.signal,
      onProgress: ({ done }) => request.progress?.update(doneBeforeRange + done),
    })
    if (request.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    rows.forEach((row, offset) => resolved.set(range[0] + offset, row))
    doneBefore += range[1] - range[0]
    request.progress?.update(doneBefore)
  }
  return resolved
}

function finishRowProgress(progress: RowProgress | undefined): boolean {
  return progress?.finish() ?? false
}

function countRows(ranges: Array<[number, number]>): number {
  return ranges.reduce((sum, [start, end]) => sum + (end - start), 0)
}

function countFetchChunks(ranges: Array<[number, number]>): number {
  return ranges.reduce((sum, [start, end]) => sum + Math.ceil((end - start) / ROW_FETCH_CHUNK), 0)
}

function reportRowActionLoadFailure(
  verb: GridRowActionVerb,
  error: unknown,
  rowActions: GridRowActions | undefined
): void {
  if (isAbort(error)) return
  if (isResultsExpired(error)) {
    rowActions?.onExpired()
    return
  }
  const failure = ROW_ACTION_FAILURES[verb]
  logFrontend('warn', `[grid] ${verb} could not load rows: ${toErrorMessage(error)}`)
  showErrorToast(failure.title, failure.message)
}

function visibleRepaintRange(loadedRange: RowRange, region: Rectangle | null): RowRange {
  const [start, end] = loadedRange
  if (!region) return [start, Math.min(end, start + VISIBLE_REPAINT_FALLBACK_ROWS)]
  return [Math.max(start, region.y), Math.min(end, region.y + region.height)]
}

function cellsInRowSpan(span: RowRange, columnCount: number): Array<readonly [number, number]> {
  const [from, to] = span
  const cells: Array<readonly [number, number]> = []
  for (let row = from; row < to; row++) {
    for (let column = 0; column < columnCount; column++) cells.push([column, row])
  }
  return cells
}

interface EditorSessionBaselineInput {
  row: GridRow | undefined
  column: GridColumn<GridRow> | undefined
  rowIndex: number
  editState: RowEditState | null
}

function buildEditorSessionBaseline(
  input: EditorSessionBaselineInput
): EditorSessionBaseline | null {
  const { row, column, rowIndex, editState } = input
  if (!column || !row) return null
  return {
    rowIndex: rowIndex,
    columnKey: column.key,
    value: normalizeEditorValue(resolveEditorBaselineValue(row, column.key, editState)),
  }
}

function hasPasteLine(line: readonly string[] | undefined): line is readonly string[] {
  return line !== undefined && line.length > 0
}

function isRowInGrid(rowIndex: number, rowCount: number): boolean {
  return rowIndex >= 0 && rowIndex < rowCount
}

interface FocusedCellSources {
  selectedCell: GridCellPosition | null | undefined
  selectionCell: Item | undefined
  lastInteractedCell: GridCellPosition | null
}

function resolveFocusedCell(sources: FocusedCellSources): GridCellPosition | null {
  return sources.selectedCell ?? toCellPosition(sources.selectionCell) ?? sources.lastInteractedCell
}

function resolveKeyboardCell(
  selectionCell: Item | undefined,
  selectedCell: GridCellPosition | null | undefined
): GridCellPosition | null {
  return toCellPosition(selectionCell) ?? selectedCell ?? null
}

interface TypingActivationRequest {
  cell: GridCellPosition
  row: GridRow
  columnKey: string
  typedValue: string
  cancelRestoreValue: unknown
}

function canStartTypedEdit(
  guard: CellClickGuardResult,
  column: GridColumn<GridRow> | undefined,
  editableColumnKeys: ReadonlySet<string> | undefined
): column is GridColumn<GridRow> {
  return guard.enableEditor && column !== undefined && editableColumnKeys?.has(column.key) === true
}

function clampIndex(value: number, lastIndex: number): number {
  return Math.max(0, Math.min(lastIndex, value))
}

function resolveKeyboardRow(
  currentCell: GridCellPosition | null,
  activeSelectedRowIndex: number | null
): number {
  return currentCell?.rowIdx ?? activeSelectedRowIndex ?? 0
}

function resolveKeyboardColumn(currentCell: GridCellPosition | null): number {
  return currentCell?.idx ?? 0
}

function cancelGlideKey(event: GlideKeyDownEvent): void {
  event.preventDefault()
  event.cancel?.()
}

function isShortcutKey(event: GlideKeyDownEvent, key: string): boolean {
  const isShortcut = event.metaKey || event.ctrlKey
  return isShortcut && event.key.toLowerCase() === key
}

const INTERACTIVE_TAG_NAMES = ['button', 'input', 'select', 'textarea', 'a']

function isInteractiveElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return INTERACTIVE_TAG_NAMES.includes(tag) || target.isContentEditable
}

function isEditableListColumn(
  column: GridColumn<GridRow> | undefined,
  isEditMode: boolean | undefined,
  editableColumnKeys: ReadonlySet<string> | undefined
): column is EnumGridColumn | SetGridColumn {
  return isListSelectionColumn(column) && isEditableColumn(column, isEditMode, editableColumnKeys)
}

function isSingleRowCheckAdded(next: CompactSelection, previous: CompactSelection): boolean {
  return next.length === previous.length + 1
}

function haveSameRowIndexes(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function isForeignKeyLookupColumn(
  column: GridColumn<GridRow> | undefined
): column is GridColumn<GridRow> {
  if (!column?.foreignKey) return false
  return !isListSelectionColumn(column)
}

type CellDrawArgs = Parameters<DrawCellCallback>[0]

interface CellDrawState {
  row: GridRow | undefined
  column: GridColumn<GridRow> | undefined
  isSelected: boolean
  isEditing: boolean
  isHighlightedColumn: boolean
  isModified: boolean
  hasInfoAffordance: boolean
}

interface ModifiedCellCheck {
  row: GridRow | undefined
  column: GridColumn<GridRow> | undefined
  isModifiedCell: CanvasBaseGridViewProps['isModifiedCell']
}

function isCellModified(check: ModifiedCellCheck): boolean {
  const { row, column, isModifiedCell } = check
  if (!row || !column) return false
  return isModifiedCell?.(row, column.key) === true
}

function drawCellBackground(args: CellDrawArgs, state: CellDrawState): void {
  if (state.isHighlightedColumn) {
    drawHighlightedColumnBackground(args.ctx, args.rect, args.theme.bgSearchResult)
  }
  if (state.isSelected) {
    drawHighlightedColumnBackground(args.ctx, args.rect, args.theme.bgBubbleSelected)
    drawSelectedRowAccent(args.ctx, args.rect, args.theme.accentColor)
  }
  if (state.isEditing) {
    drawHighlightedColumnBackground(args.ctx, args.rect, args.theme.bgHeaderHovered)
  }
}

function drawCellContent(args: CellDrawArgs, state: CellDrawState, drawContent: () => void): void {
  if (state.hasInfoAffordance) {
    drawContentBesideInfoGutter(args, drawContent)
    return
  }
  drawContent()
}

function drawCellOverlays(args: CellDrawArgs, state: CellDrawState): void {
  if (state.isModified) {
    drawModifiedCellIndicator(args.ctx, args.rect, args.theme.accentColor, false)
  }
  if (state.hasInfoAffordance) {
    drawInfoAffordance(args.ctx, args.rect, args.theme.linkColor)
  }
  if (state.row && isForeignKeyLookupColumn(state.column)) {
    drawForeignKeyEllipsis(args.ctx, args.rect, args.theme.linkColor)
  }
}

function withoutUnloadedRowCheck(
  selection: GridSelection,
  previousRows: CompactSelection,
  source: GridRowSource<GridRow>
): GridSelection {
  if (!isSingleRowCheckAdded(selection.rows, previousRows)) return selection
  const added = findAddedIndex(selection.rows, previousRows)
  if (added === undefined || source.isLoaded(added)) return selection
  return { ...selection, rows: previousRows }
}

function drawContentBesideInfoGutter(args: CellDrawArgs, drawContent: () => void): void {
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
}

function skeletonLineHeight(theme: CellDrawArgs['theme']): number {
  return parseFloat(theme.editorFontSize) || SKELETON_FALLBACK_LINE_PX
}

interface GridClipboardMenuProps {
  menu: { x: number; y: number; portalRoot: HTMLElement }
  menuRef: React.RefObject<HTMLDivElement | null>
  testId: string | undefined
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
}

function GridClipboardMenu({
  menu,
  menuRef,
  testId,
  onCopy,
  onCut,
  onPaste,
}: GridClipboardMenuProps) {
  return createPortal(
    <div
      ref={menuRef}
      className="ui-context-menu"
      role="menu"
      data-testid={clipboardMenuTestId(testId)}
      style={{
        left: menu.x,
        top: menu.y,
        position: getContextMenuPositionMode(menu.portalRoot),
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Button variant="bare" className="ui-context-menu__item" role="menuitem" onClick={onCopy}>
        <CopySimple className="ui-context-menu__icon" size={18} weight="regular" aria-hidden />
        <span>Copy</span>
      </Button>
      <Button variant="bare" className="ui-context-menu__item" role="menuitem" onClick={onCut}>
        <Scissors className="ui-context-menu__icon" size={18} weight="regular" aria-hidden />
        <span>Cut</span>
      </Button>
      <Button variant="bare" className="ui-context-menu__item" role="menuitem" onClick={onPaste}>
        <ClipboardText className="ui-context-menu__icon" size={18} weight="regular" aria-hidden />
        <span>Paste</span>
      </Button>
    </div>,
    menu.portalRoot
  )
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
    resetSelectionKey,
  } = props
  const { rowMarkers, showInfoColumn, isActive, runCellClickGuardOnKeyboardSelection } =
    resolveGridBehaviourFlags(props)
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
  const previousMarkedRowsRef = useRef<number[]>([])
  const previousMarkedRangesKeyRef = useRef('[]')
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
      scrollToCell: (position, axis) => {
        pendingInitialScrollRestoreRef.current = null
        suppressScrollPersistenceRef.current = false
        gridRef.current?.scrollToCell(position, axis)
      },
      selectCell: (position, options) => {
        pendingInitialScrollRestoreRef.current = null
        suppressScrollPersistenceRef.current = false
        gridRef.current?.selectCell(position, options)
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
    async (rowIndex: number, columnIndex: number): Promise<boolean> => {
      const fromRow = selectedCellPosition?.rowIdx ?? activeSelectedRowIndex
      if (fromRow != null && fromRow !== rowIndex && onRowChanging) {
        const ok = await onRowChanging(fromRow, rowIndex)
        if (!ok) {
          if (selectedCellPosition)
            gridRef.current?.selectCell(selectedCellPosition, { shouldFocusCell: true })
          return false
        }
      }
      onSelectedCellChange?.({ rowIdx: rowIndex, idx: columnIndex })
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
    previousMarkedRangesKeyRef.current = '[]'
    setGridSelection((current) => {
      if (!current || current.rows.length === 0) return current
      return { ...current, rows: CompactSelection.empty() }
    })
  }

  const buildCellForRow = useCallback(
    (row: GridRow, columnIndex: number, rowIndex: number): GridCell => {
      const column = gridColumns[columnIndex]
      if (!column) return buildEmptyTextCell()
      const rawValue = row[column.key]
      if (column.cellKind === 'checkbox') return buildCheckboxCell(rawValue)
      const isSelectedRow = activeSelectedRowIndex === rowIndex || isRowSelected(row)
      const flags = classifyCellValue(rawValue, column.key, {
        isReadOnly: isReadOnlyInEditMode(column, isEditMode, editableColumnKeys),
        isModified: isModifiedCell?.(row, column.key) ?? false,
        isFkCell: column.foreignKey != null,
        isBlobColumn: column.isBinary === true,
        isSelectedRow: isSelectedRow,
        isEditingRow: isRowEditing(row),
        highlightedColumnKey: highlightColumnKey,
      })
      return buildDataCell({
        row: row,
        rowIndex: rowIndex,
        column: column,
        flags: flags,
        editable: isEditableColumn(column, isEditMode, editableColumnKeys),
        pendingTypingActivation: pendingTypingActivationRef.current,
      })
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
    ([columnIndex, rowIndex]: Item): GridCell => {
      const row = source.getRow(rowIndex)
      if (!row) {
        return isWindowed
          ? { kind: GridCellKind.Loading, allowOverlay: false }
          : buildEmptyTextCell()
      }
      return buildCellForRow(row, columnIndex, rowIndex)
    },
    [buildCellForRow, isWindowed, source]
  )

  /** Windowed `getCellsForSelection`: synchronous, loaded rows only, never fetches. */
  const getCellsForSelection = useCallback(
    (rect: Rectangle): readonly (readonly GridCell[])[] =>
      Array.from({ length: rect.height }, (_, rowOffset) =>
        Array.from({ length: rect.width }, (_, columnOffset) =>
          getCellContent([rect.x + columnOffset, rect.y + rowOffset])
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

  const selectCellFromPointer = useCallback(
    async (cell: GridCellPosition, row: GridRow, columnKey: string): Promise<void> => {
      if (actionPendingRef.current) return
      const guard = onCellClickGuard
        ? await onCellClickGuard({ rowIdx: cell.rowIdx, columnKey: columnKey, rowData: row })
        : proceedWithoutGuard(cell, false)
      if (!guard.proceed) {
        restoreFocusAfterRejectedGuard(gridRef.current, guard)
        return
      }
      const ok = await changeSelectedCell(guard.targetRowIdx, guard.targetColIdx)
      if (!ok) return
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
      if (guard.enableEditor) openListEditor(guardTargetCell(guard))
    },
    [
      changeSelectedCell,
      gridColumns,
      onCellClickGuard,
      onCellSelectionChange,
      openListEditor,
      selectRow,
      source,
    ]
  )

  const runForeignKeyLookupFromPointer = useCallback(
    async (cell: GridCellPosition, row: GridRow, columnKey: string): Promise<void> => {
      const ok = await changeSelectedCell(cell.rowIdx, cell.idx)
      if (!ok) return
      selectRow(cell.rowIdx)
      await onFkCellAction?.({
        rowIdx: cell.rowIdx,
        columnKey: columnKey,
        rowData: row,
        source: 'grid-pointer',
      })
    },
    [changeSelectedCell, onFkCellAction, selectRow]
  )

  const openForeignKeyLookupFromPointer = useCallback(
    (cell: GridCellPosition, row: GridRow, columnKey: string): void => {
      void runForeignKeyLookupFromPointer(cell, row, columnKey)
      onCellSelectionChange?.({ rowIdx: cell.rowIdx, columnKey: columnKey, rowData: row })
      onRowClick?.(row, columnKey)
    },
    [onCellSelectionChange, onRowClick, runForeignKeyLookupFromPointer]
  )

  const handleCellClicked = useCallback(
    (cell: Item, event: CellClickedEventArgs) => {
      const [columnIndex, rowIndex] = cell
      const row = source.getRow(rowIndex)
      const column = gridColumns[columnIndex]
      if (!row || !column) return
      const position = { rowIdx: rowIndex, idx: columnIndex }
      lastInteractedCellRef.current = position

      if (isForeignKeyAffordanceClick(column, event)) {
        // Glide treats a click on the selected cell as a second click and would also open its editor.
        event.preventDefault()
        openForeignKeyLookupFromPointer(position, row, column.key)
        return
      }

      if (isInfoAffordanceClick(column, row, event)) {
        onInfoCellClick?.(row, boundsToDomRect(event.bounds))
        return
      }

      void selectCellFromPointer(position, row, column.key)
      onRowClick?.(row, column.key)
      if (hasInfoText(column, row) && event.bounds) {
        onInfoCellClick?.(row, boundsToDomRect(event.bounds))
      }
    },
    [
      gridColumns,
      onInfoCellClick,
      onRowClick,
      openForeignKeyLookupFromPointer,
      selectCellFromPointer,
      source,
    ]
  )

  const handleCellEdited = useCallback(
    (cell: Item, newValue: EditableGridCell) => {
      const [columnIndex, rowIndex] = cell
      const column = gridColumns[columnIndex]
      if (!column) return
      const next = resolveEditedCellValue(column, newValue)
      if (next === undefined) return
      const edit = { rowIndex: rowIndex, columnKey: column.key, value: next }
      const isPendingTypingActivation = isPendingTypingActivationCommit(
        pendingTypingActivationRef.current,
        edit
      )
      if (isPendingTypingActivation) {
        pendingTypingActivationRef.current = null
      }
      const isNoOpCommit =
        !isPendingTypingActivation &&
        isUnchangedEditorCommit(editorSessionBaselineRef.current, edit)
      if (!isNoOpCommit) {
        onCellValueChange?.(rowIndex, column.key, next)
      }
      if (!onRowsChange || isWindowed) return
      const nextRows = isNoOpCommit ? rowsProp : withCellValue(rowsProp, edit)
      onRowsChange(nextRows, { indexes: [rowIndex], column: column })
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
      const needsFetch =
        isWindowed && merged.some(([start, end]) => !isRangeLoaded(source, start, end))
      if (!needsFetch) {
        return act((index) => source.getRow(index))
      }

      const total = countRows(merged)
      const controller = new AbortController()
      const cancelFetch = countFetchChunks(merged) > 1 ? () => controller.abort() : undefined
      actionPendingRef.current = true
      actionAbortRef.current = controller
      const progress = rowActions?.begin(verb, total, cancelFetch)
      const releasePendingAction = () => {
        actionPendingRef.current = false
        actionAbortRef.current = null
      }
      let resolved: Map<number, GridRow>
      try {
        resolved = await loadRowRanges({
          source: source,
          ranges: merged,
          signal: controller.signal,
          progress: progress,
        })
      } catch (error) {
        finishRowProgress(progress)
        releasePendingAction()
        reportRowActionLoadFailure(verb, error, rowActions)
        return false
      }
      releasePendingAction()
      const wasVisible = finishRowProgress(progress)
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
    (row: GridRow, columnIndex: number, rowIndex: number): string => {
      const cell = buildCellForRow(row, columnIndex, rowIndex)
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
      targetColumn: number,
      line: readonly string[]
    ): Promise<boolean> => {
      const isPasteTarget = (columnIndex: number): boolean => {
        const column = gridColumns[columnIndex]
        if (!column || isListSelectionColumn(column) || isInfoColumn(column)) return false
        const cell = buildCellForRow(row, columnIndex, rowIndex)
        return !('readonly' in cell && cell.readonly === true)
      }
      const first = line.findIndex((_, offset) => isPasteTarget(targetColumn + offset))
      if (first < 0) return false
      const started = await onCellClipboardEdit?.({
        rowIdx: rowIndex,
        rowData: row,
        columnKey: gridColumns[targetColumn + first].key,
        action: 'paste',
        text: line[first],
      })
      if (started !== true) return false
      line.forEach((text, offset) => {
        const columnIndex = targetColumn + offset
        if (offset <= first || columnIndex >= gridColumns.length) return
        const pasted = pasteTextIntoCell(buildCellForRow(row, columnIndex, rowIndex), text)
        if (pasted) handleCellEdited([columnIndex, rowIndex], pasted)
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
      const [columnIndex, rowIndex] = target
      const column = gridColumns[columnIndex]
      const line = values[0]
      if (!column || !hasPasteLine(line) || !isRowInGrid(rowIndex, rowCount)) return false
      if (isListSelectionColumn(column)) return false
      if (actionPendingRef.current) return false
      // Only the result grid is windowed; it pastes only in edit mode.
      if (isWindowed && !source.isLoaded(rowIndex) && isEditMode !== true) return false
      void runRowAction('Pasting', [[rowIndex, rowIndex + 1]], async (rowAt) => {
        const row = rowAt(rowIndex)
        if (!row) return false
        const pasted = await pasteLineIntoRow(rowIndex, row, columnIndex, line)
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

  const clearCellsWithRows = useCallback(
    (range: Rectangle, rowAt: (index: number) => GridRow | undefined) => {
      const nextRows = isWindowed ? [] : rowsProp.slice()
      const changedIndexes = new Set<number>()
      for (let rowIndex = range.y; rowIndex < range.y + range.height; rowIndex += 1) {
        if (!rowAt(rowIndex)) continue
        for (let columnIndex = range.x; columnIndex < range.x + range.width; columnIndex += 1) {
          const column = gridColumns[columnIndex]
          if (!isClearableColumn(column)) continue
          const clearedValue = clearedValueFor(column)
          const clearedCell = buildClearedCell(column, clearedValue)
          if (!clearedCell) continue
          handleCellEdited([columnIndex, rowIndex], clearedCell)
          nextRows[rowIndex] = { ...nextRows[rowIndex], [column.key]: clearedValue }
          changedIndexes.add(rowIndex)
        }
      }
      const shouldReportRows = changedIndexes.size > 0 && !isWindowed
      if (shouldReportRows) {
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
      for (const columnIndex of selection.columns) {
        rects.push({ x: columnIndex, y: 0, width: 1, height: rowCount })
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
              return Array.from({ length: rect.width }, (_, columnOffset) =>
                row ? cellCopyText(row, rect.x + columnOffset, rowIndex) : ''
              ).join('\t')
            })
          )
          .join('\n')
        if (!text) return false
        try {
          await writeClipboardText(text)
        } catch (error) {
          const failure = ROW_ACTION_FAILURES[verb]
          logFrontend(
            'warn',
            `Failed to write grid selection to clipboard: ${toErrorMessage(error)}`
          )
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

  const activeSelectionCell = currentSelectionCell(activeGridSelection)

  const pasteClipboardAtSelection = useCallback(async (): Promise<void> => {
    const target = activeSelectionCell
    if (!target || actionPendingRef.current) return
    let text: string
    try {
      text = await readClipboardText()
    } catch (error) {
      logFrontend('warn', `Failed to read grid clipboard text: ${toErrorMessage(error)}`)
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

  const gridColumnCount = gridColumns.length
  useEffect(() => {
    if (!source.subscribe) return undefined
    return source.subscribe((loadedRange, info) => {
      const region = lastVisibleRegionRef.current
      if (info?.reseeded && region) {
        source.onVisibleRangeChange?.([region.y, region.y + region.height])
      }
      const [from, to] = visibleRepaintRange(loadedRange, region)
      if (to <= from) return
      gridRef.current?.updateCells?.(cellsInRowSpan([from, to], gridColumnCount))
    })
  }, [gridColumnCount, source])

  const handleCellActivatedForEditing = useCallback(
    (cell: Item) => {
      const [columnIndex, rowIndex] = cell
      const column = gridColumns[columnIndex]
      const row = source.getRow(rowIndex)
      editorSessionBaselineRef.current = buildEditorSessionBaseline({
        row: row,
        column: column,
        rowIndex: rowIndex,
        editState: editState,
      })
      isEditingCellRef.current = true
    },
    [editState, gridColumns, source]
  )

  const handleCellDoubleClicked = useCallback(
    (cell: Item) => {
      const [columnIndex, rowIndex] = cell
      const row = source.getRow(rowIndex)
      const column = gridColumns[columnIndex]
      if (!row || !column) return
      onCellDoubleClick?.(row, column.key)
      onRowDoubleClicked?.(row)
    },
    [gridColumns, onCellDoubleClick, onRowDoubleClicked, source]
  )

  const gridSelectionCell = currentSelectionCell(gridSelection)

  const triggerForeignKeyLookupFromSelection = useCallback(
    (event: { preventDefault: () => void }) => {
      const position = resolveFocusedCell({
        selectedCell: selectedCellPosition,
        selectionCell: gridSelectionCell,
        lastInteractedCell: lastInteractedCellRef.current,
      })
      if (!position) return false
      const row = source.getRow(position.rowIdx)
      const column = gridColumns[position.idx]
      if (!row || !isForeignKeyLookupColumn(column)) return false
      event.preventDefault()
      void onFkCellAction?.({
        rowIdx: position.rowIdx,
        columnKey: column.key,
        rowData: row,
        source: 'keyboard',
      })
      return true
    },
    [gridColumns, gridSelectionCell, onFkCellAction, source, selectedCellPosition]
  )

  const selectCellWithoutEditor = useCallback((cell: GridCellPosition) => {
    gridRef.current?.selectCell(cell, { shouldFocusCell: true, enableEditor: false })
  }, [])

  const applyGuardedKeyboardSelection = useCallback(
    async (guard: CellClickGuardResult, request: CellClickGuardArgs): Promise<void> => {
      if (!guard.proceed) {
        restoreFocusAfterRejectedGuard(gridRef.current, guard)
        return
      }
      const ok = await changeSelectedCell(guard.targetRowIdx, guard.targetColIdx)
      if (!ok) return
      selectRow(guard.targetRowIdx)
      selectGuardTarget(gridRef.current, guard)
      onCellSelectionChange?.({
        rowIdx: guard.targetRowIdx,
        columnKey: gridColumns[guard.targetColIdx]?.key ?? request.columnKey,
        rowData: source.getRow(guard.targetRowIdx) ?? request.rowData,
        source: 'keyboard',
      })
    },
    [changeSelectedCell, gridColumns, onCellSelectionChange, selectRow, source]
  )

  const applyKeyboardSelection = useCallback(
    async (request: CellClickGuardArgs, columnIndex: number): Promise<void> => {
      if (runCellClickGuardOnKeyboardSelection && onCellClickGuard) {
        const guard = await onCellClickGuard(request)
        await applyGuardedKeyboardSelection(guard, request)
        return
      }
      const ok = await changeSelectedCell(request.rowIdx, columnIndex)
      if (!ok) return
      selectRow(request.rowIdx)
      selectCellWithoutEditor({ rowIdx: request.rowIdx, idx: columnIndex })
      onCellSelectionChange?.(request)
    },
    [
      applyGuardedKeyboardSelection,
      changeSelectedCell,
      onCellClickGuard,
      onCellSelectionChange,
      runCellClickGuardOnKeyboardSelection,
      selectCellWithoutEditor,
      selectRow,
    ]
  )

  const moveSelectionVertically = useCallback(
    (delta: -1 | 1, currentCell: GridCellPosition | null) => {
      const currentRow = resolveKeyboardRow(currentCell, activeSelectedRowIndex)
      const nextRow = clampIndex(currentRow + delta, rowCount - 1)
      const nextColumnIndex = resolveKeyboardColumn(currentCell)
      const isAtGridEdge = nextRow === currentRow && currentCell !== null
      if (isAtGridEdge) {
        if (activeSelectedRowIndex !== nextRow) selectRow(nextRow)
        selectCellWithoutEditor({ rowIdx: nextRow, idx: nextColumnIndex })
        return
      }
      const nextRowData = source.getRow(nextRow)
      const nextColumn = gridColumns[nextColumnIndex]
      if (!nextRowData || !nextColumn) return
      const request: CellClickGuardArgs = {
        rowIdx: nextRow,
        columnKey: nextColumn.key,
        rowData: nextRowData,
        source: 'keyboard',
      }
      void applyKeyboardSelection(request, nextColumnIndex)
    },
    [
      activeSelectedRowIndex,
      applyKeyboardSelection,
      gridColumns,
      rowCount,
      selectCellWithoutEditor,
      selectRow,
      source,
    ]
  )

  const moveSelectionHorizontally = useCallback(
    (delta: -1 | 1, currentCell: GridCellPosition | null) => {
      const currentRow = resolveKeyboardRow(currentCell, activeSelectedRowIndex)
      const currentColumn = resolveKeyboardColumn(currentCell)
      const nextColumn = clampIndex(currentColumn + delta, gridColumns.length - 1)
      if (nextColumn !== currentColumn) {
        void changeSelectedCell(currentRow, nextColumn)
      }
      selectCellWithoutEditor({ rowIdx: currentRow, idx: nextColumn })
    },
    [activeSelectedRowIndex, changeSelectedCell, gridColumns.length, selectCellWithoutEditor]
  )

  const startTypingEditor = useCallback(
    async (request: TypingActivationRequest): Promise<void> => {
      const guard = onCellClickGuard
        ? await onCellClickGuard({
            rowIdx: request.cell.rowIdx,
            columnKey: request.columnKey,
            rowData: request.row,
            source: 'keyboard-typing',
          })
        : proceedWithoutGuard(request.cell, true)
      if (!guard.proceed) {
        restoreFocusAfterRejectedGuard(gridRef.current, guard)
        return
      }
      const ok = await changeSelectedCell(guard.targetRowIdx, guard.targetColIdx)
      if (!ok) return
      selectRow(guard.targetRowIdx)
      const targetColumn = gridColumns[guard.targetColIdx]
      if (canStartTypedEdit(guard, targetColumn, editableColumnKeys)) {
        pendingTypingActivationRef.current = {
          rowIndex: guard.targetRowIdx,
          columnKey: targetColumn.key,
          value: request.typedValue,
          cancelRestoreValue: request.cancelRestoreValue,
        }
      }
      selectGuardTarget(gridRef.current, guard)
    },
    [changeSelectedCell, editableColumnKeys, gridColumns, onCellClickGuard, selectRow]
  )

  const handleTypingActivation = useCallback(
    (event: GlideKeyDownEvent, currentCell: GridCellPosition) => {
      if (actionPendingRef.current) {
        cancelGlideKey(event)
        return
      }
      const currentRow = source.getRow(currentCell.rowIdx)
      const currentColumn = gridColumns[currentCell.idx]
      if (!currentRow || !currentColumn) return
      if (isListSelectionColumn(currentColumn)) {
        cancelGlideKey(event)
        return
      }
      const cancelRestoreValue = resolveEditorBaselineValue(
        currentRow,
        currentColumn.key,
        editState
      )
      cancelGlideKey(event)
      void startTypingEditor({
        cell: currentCell,
        row: currentRow,
        columnKey: currentColumn.key,
        typedValue: event.key,
        cancelRestoreValue: cancelRestoreValue,
      })
    },
    [editState, gridColumns, source, startTypingEditor]
  )

  const handlePendingActionKey = useCallback(
    (event: GlideKeyDownEvent): boolean => {
      if (event.key === 'Escape' && actionPendingRef.current) {
        cancelGlideKey(event)
        actionAbortRef.current?.abort()
        return true
      }
      if (isWindowed && isShortcutKey(event, 'c')) {
        cancelGlideKey(event)
        void copySelectionToClipboard()
        return true
      }
      if (isShortcutKey(event, 'x')) {
        cancelGlideKey(event)
        void cutSelectionToClipboard()
        return true
      }
      return false
    },
    [copySelectionToClipboard, cutSelectionToClipboard, isWindowed]
  )

  const handleEnterKey = useCallback(
    (event: GlideKeyDownEvent, currentCell: GridCellPosition | null) => {
      const currentColumn = currentCell ? gridColumns[currentCell.idx] : undefined
      if (currentCell && isEditableListColumn(currentColumn, isEditMode, editableColumnKeys)) {
        cancelGlideKey(event)
        openListEditor(currentCell)
        return
      }
      if (activeSelectedRowIndex == null) return
      const row = source.getRow(activeSelectedRowIndex)
      if (!row) return
      event.preventDefault()
      onRowDoubleClicked?.(row)
    },
    [
      activeSelectedRowIndex,
      editableColumnKeys,
      gridColumns,
      isEditMode,
      onRowDoubleClicked,
      openListEditor,
      source,
    ]
  )

  const handleKeyDown = useCallback<(event: GlideKeyDownEvent) => void>(
    (event) => {
      if (rowCount === 0) return
      if (handlePendingActionKey(event)) return
      const currentCell = resolveKeyboardCell(gridSelectionCell, selectedCellPosition)
      const arrowKeyMoves: Record<string, () => void> = {
        ArrowDown: () => moveSelectionVertically(1, currentCell),
        ArrowUp: () => moveSelectionVertically(-1, currentCell),
        ArrowRight: () => moveSelectionHorizontally(1, currentCell),
        ArrowLeft: () => moveSelectionHorizontally(-1, currentCell),
      }
      const moveByArrow = arrowKeyMoves[event.key]
      if (moveByArrow) {
        cancelGlideKey(event)
        moveByArrow()
        return
      }
      if (isTypingActivationKey(event) && currentCell) {
        handleTypingActivation(event, currentCell)
        return
      }
      if (event.key === 'Enter') {
        handleEnterKey(event, currentCell)
        return
      }
      if (isActive && event.key === 'F4') {
        event.cancel?.()
        triggerForeignKeyLookupFromSelection(event)
      }
    },
    [
      gridSelectionCell,
      handleEnterKey,
      handlePendingActionKey,
      handleTypingActivation,
      isActive,
      moveSelectionHorizontally,
      moveSelectionVertically,
      rowCount,
      selectedCellPosition,
      triggerForeignKeyLookupFromSelection,
    ]
  )

  useEffect(() => {
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (!isActive) return
      if (isInteractiveElement(event.target)) return
      const documentCell = resolveFocusedCell({
        selectedCell: selectedCellPosition,
        selectionCell: currentSelectionCell(gridSelection),
        lastInteractedCell: lastInteractedCellRef.current,
      })
      if (event.key === 'Enter' && documentCell) {
        const column = gridColumns[documentCell.idx]
        if (isEditableListColumn(column, isEditMode, editableColumnKeys)) {
          event.preventDefault()
          openListEditor(documentCell)
          return
        }
      }
      if (event.defaultPrevented) return
      if (event.key !== 'F4') return
      triggerForeignKeyLookupFromSelection(event)
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
    triggerForeignKeyLookupFromSelection,
  ])

  const reportRowMarkerRanges = useCallback(
    (rows: CompactSelection) => {
      const ranges = selectionRowRanges(rows)
      const key = JSON.stringify(ranges)
      if (key === previousMarkedRangesKeyRef.current) return
      previousMarkedRangesKeyRef.current = key
      onRowMarkerRangesChange?.(ranges)
    },
    [onRowMarkerRangesChange]
  )

  const reportMarkedRows = useCallback(
    (rows: CompactSelection) => {
      if (!onRowMarkersChange) return
      const selectedRowIndices = [...rows]
      if (haveSameRowIndexes(selectedRowIndices, previousMarkedRowsRef.current)) return
      previousMarkedRowsRef.current = selectedRowIndices
      const selected = selectedRowIndices
        .map((rowIndex) => source.getRow(rowIndex))
        .filter((row): row is GridRow => row != null)
      onRowMarkersChange(selected)
    },
    [onRowMarkersChange, source]
  )

  const handleSelectionChange = useCallback(
    (nextSelection: GridSelection) => {
      const previousRows = gridSelection?.rows ?? CompactSelection.empty()
      const selection = isWindowed
        ? withoutUnloadedRowCheck(nextSelection, previousRows, source)
        : nextSelection
      setGridSelection(selection)
      const selectedCell = toCellPosition(currentSelectionCell(selection))
      if (selectedCell) {
        lastInteractedCellRef.current = selectedCell
        const column = gridColumns[selectedCell.idx]
        lastSelectedListCellRef.current = isListSelectionColumn(column) ? selectedCell : null
      }
      if (isWindowed && onRowMarkerRangesChange) {
        reportRowMarkerRanges(selection.rows)
        return
      }
      reportMarkedRows(selection.rows)
    },
    [
      gridColumns,
      gridSelection,
      isWindowed,
      onRowMarkerRangesChange,
      reportMarkedRows,
      reportRowMarkerRanges,
      source,
    ]
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
    const element = clipboardMenuRef.current
    const rect = element.getBoundingClientRect()
    const position = positionContextMenuInPortal(
      contextMenu.portalRoot,
      contextMenu.x,
      contextMenu.y,
      rect.width,
      rect.height
    )
    element.style.left = `${position.x}px`
    element.style.top = `${position.y}px`
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
        drawSkeletonCell(
          args.ctx,
          args.rect,
          skeletonColor,
          args.theme.cellHorizontalPadding,
          skeletonLineHeight(args.theme)
        )
        return
      }
      const isSelected = row != null && (activeSelectedRowIndex === args.row || isRowSelected(row))
      const state: CellDrawState = {
        row: row,
        column: column,
        isSelected: isSelected,
        isEditing: row != null && isRowEditing(row),
        isHighlightedColumn: column?.key === highlightColumnKey,
        isModified: isCellModified({ row: row, column: column, isModifiedCell: isModifiedCell }),
        hasInfoAffordance: hasInfoText(column, row),
      }
      drawCellBackground(args, state)
      drawCellContent(args, state, drawContent)
      drawCellOverlays(args, state)
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

  const rowSourceGridProps = isWindowed
    ? {
        rows: EMPTY_GRID_ROWS,
        rowCount: rowCount,
        getCellsForSelection: getCellsForSelection,
        keybindings: WINDOWED_KEYBINDINGS,
      }
    : { rows: rowsProp }

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
        {...rowSourceGridProps}
        getCellContent={getCellContent}
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
        aria-label={gridAriaLabel(testId)}
        data-testid={testId}
      />
      {contextMenu && (
        <GridClipboardMenu
          menu={contextMenu}
          menuRef={clipboardMenuRef}
          testId={testId}
          onCopy={() => {
            void copySelectionToClipboard()
            closeContextMenu()
          }}
          onCut={() => {
            void cutSelectionToClipboard()
            closeContextMenu()
          }}
          onPaste={() => {
            void pasteClipboardAtSelection()
            closeContextMenu()
          }}
        />
      )}
    </div>
  )
}

export const CanvasBaseGridView = forwardRef(CanvasBaseGridViewInner)
