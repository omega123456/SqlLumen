/**
 * ResultFormView — thin wrapper around BaseFormView for query results.
 *
 * Adapts the query-store shapes (ColumnMeta, RowEditState with modifiedColumns,
 * positional row arrays) into BaseFormView's normalised props (GridColumnDescriptor,
 * shared RowEditState with col_N keys, navigation callbacks with auto-save).
 *
 * Rows are windowed: the form shows the row at the selected **view position**,
 * read from the page cache and fetched by view range when it isn't loaded, so
 * navigation covers the whole view. The clone draft is a virtual row after the
 * last view row.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BaseFormView } from '../shared/BaseFormView'
import { QueryResultBlobDialog, type QueryResultBlobContext } from './QueryResultBlobDialog'
import { columnKey, columnIndexFromKey } from '../../lib/col-key-utils'
import { resolveQueryResultColumns } from '../../lib/query-result-column-utils'
import { isBinaryDataType } from '../../lib/blob-utils'
import { logFrontend } from '../../lib/app-log-commands'
import {
  getLoadedRow,
  isResultsExpiredError,
  readViewRange,
  subscribeToResultWindow,
  subscribeToRowPatches,
  type CachedRow,
} from '../../lib/result-window-cache'
import { useQueryStore } from '../../stores/query-store'
import type {
  GridColumnDescriptor,
  RowEditState as SharedRowEditState,
} from '../../types/shared-data-view'
import type {
  ColumnMeta,
  BlobEnvelope,
  ForeignKeyColumnInfo,
  TableDataColumnMeta,
  RowEditState,
} from '../../types/schema'
import { toErrorMessage } from '../../lib/error-message'
import { hasModifiedColumns } from '../../lib/row-edit-state'

// ---------------------------------------------------------------------------
// Props (unchanged external interface)
// ---------------------------------------------------------------------------

export interface ResultFormViewProps {
  columns: ColumnMeta[]
  /** Result index within the tab (page-cache surface). */
  resultIndex: number
  /** Query id of the cached result. */
  queryId: string | null
  /** View version of the current view. */
  viewVersion: number
  /** Rows in the current view. */
  viewRowCount: number
  /** Clone draft row (a virtual row at `viewRowCount`), or null. */
  draftRow?: unknown[] | null
  /** View position (0-based), or null for the first row. */
  selectedRowIndex: number | null
  /** Called with 'prev' or 'next' — parent handles setSelectedRow. */
  onNavigate: (direction: 'prev' | 'next') => void
  tabId: string

  // --- Edit mode props (optional — null/empty when not in edit mode) ---

  /** Selected table name for editing, or null for read-only. */
  editMode?: string | null
  /** Column index → editable boolean for the selected edit table. */
  editableColumnMap?: Map<number, boolean>
  /** Current row edit state. */
  editState?: RowEditState | null
  /** View position of the editing row. */
  editingRowIndex?: number | null
  /** Column metadata from the edit table (for cell editor selection). */
  editTableColumns?: TableDataColumnMeta[]
  /** FK metadata from the edit table (single-column constraints only). */
  editForeignKeys?: ForeignKeyColumnInfo[]
  /** Result column index → bound source-table column name. */
  editColumnBindings?: Map<number, string>
  /** Start editing a row by its view position (`row` when it isn't in the page cache). */
  onStartEdit?: (rowIndex: number, row?: CachedRow) => void
  /** Update a cell value in the edit state. */
  onUpdateCell?: (columnIndex: number, value: unknown) => void
  /** Save current row. */
  onSaveRow?: () => Promise<boolean>
  /** Discard current row edits. */
  onDiscardRow?: () => void
}

const EMPTY_EDITABLE_MAP = new Map<number, boolean>()
const EMPTY_TABLE_COLUMNS: TableDataColumnMeta[] = []
const EMPTY_FOREIGN_KEYS: ForeignKeyColumnInfo[] = []
const EMPTY_BINDINGS = new Map<number, string>()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ResolvedColumn = ReturnType<typeof resolveQueryResultColumns>[number]

interface FormEditProps {
  editMode: string | null
  editableColumnMap: Map<number, boolean>
  editState: RowEditState | null
  editingRowIndex: number | null
  editTableColumns: TableDataColumnMeta[]
  editForeignKeys: ForeignKeyColumnInfo[]
  editColumnBindings: Map<number, string>
}

function resolveFormEditProps(props: ResultFormViewProps): FormEditProps {
  return {
    editMode: props.editMode ?? null,
    editableColumnMap: props.editableColumnMap ?? EMPTY_EDITABLE_MAP,
    editState: props.editState ?? null,
    editingRowIndex: props.editingRowIndex ?? null,
    editTableColumns: props.editTableColumns ?? EMPTY_TABLE_COLUMNS,
    editForeignKeys: props.editForeignKeys ?? EMPTY_FOREIGN_KEYS,
    editColumnBindings: props.editColumnBindings ?? EMPTY_BINDINGS,
  }
}

interface FormRowPosition {
  totalRows: number
  currentIndex: number
  clampedIndex: number
  isDraftPosition: boolean
}

function resolveFormRowPosition(props: ResultFormViewProps): FormRowPosition {
  const hasDraftRow = props.draftRow != null
  const totalRows = props.viewRowCount + (hasDraftRow ? 1 : 0)
  // Form view can render the first row as a visual fallback before store selection exists.
  // Clone enablement is handled upstream by checking whether selectedRowIndex is committed.
  const currentIndex = props.selectedRowIndex ?? 0
  const clampedIndex = Math.max(0, Math.min(currentIndex, totalRows - 1))
  return {
    totalRows: totalRows,
    currentIndex: currentIndex,
    clampedIndex: clampedIndex,
    isDraftPosition: hasDraftRow && clampedIndex === props.viewRowCount,
  }
}

interface FetchedRow {
  key: string
  row: CachedRow
}

function fetchedRowFor(fetched: FetchedRow | null, fetchKey: string): CachedRow | null {
  if (fetched?.key !== fetchKey) return null
  return fetched.row
}

function patchFetchedRow(
  current: FetchedRow | null,
  baseIndex: number,
  apply: (row: unknown[]) => unknown[]
): FetchedRow | null {
  if (!isFetchedRowAt(current, baseIndex)) return current
  return { ...current, row: { baseIndex: baseIndex, row: apply(current.row.row) } }
}

function isFetchedRowAt(current: FetchedRow | null, baseIndex: number): current is FetchedRow {
  if (!current) return false
  return current.row.baseIndex === baseIndex
}

function useFormCurrentRow(props: ResultFormViewProps, position: FormRowPosition) {
  const { tabId, resultIndex, queryId, viewVersion } = props
  const { clampedIndex, isDraftPosition, totalRows } = position
  const draftRow = props.draftRow ?? null
  const markResultsExpired = useQueryStore((state) => state.markResultsExpired)

  // Re-render when the page holding the current row loads or is patched.
  const [windowTick, setWindowTick] = useState(0)
  useEffect(
    () =>
      subscribeToResultWindow(tabId, resultIndex, ([start, end]) => {
        const isCurrentRowInWindow = clampedIndex >= start && clampedIndex < end
        if (isCurrentRowInWindow) setWindowTick((tick) => tick + 1)
      }),
    [clampedIndex, resultIndex, tabId]
  )

  // A row outside the loaded pages is fetched by view range.
  const fetchKey = `${queryId ?? ''}:${viewVersion}:${clampedIndex}`
  const [fetched, setFetched] = useState<FetchedRow | null>(null)
  // A saved edit of the fetched row (which isn't in the page cache) patches it here.
  useEffect(
    () =>
      subscribeToRowPatches(tabId, resultIndex, (baseIndex, apply) => {
        setFetched((current) => patchFetchedRow(current, baseIndex, apply))
      }),
    [resultIndex, tabId]
  )
  const loadedRow = useMemo(() => {
    void windowTick
    if (isDraftPosition) return null
    if (totalRows === 0) return null
    return getLoadedRow(tabId, resultIndex, clampedIndex) ?? null
  }, [clampedIndex, isDraftPosition, resultIndex, tabId, totalRows, windowTick])
  const needsFetch = !isDraftPosition && totalRows > 0 && loadedRow === null
  useEffect(() => {
    if (!needsFetch) return
    if (fetched?.key === fetchKey) return
    let cancelled = false
    readViewRange(tabId, resultIndex, [clampedIndex, clampedIndex + 1])
      .then((rows) => {
        const firstRow = rows[0]
        if (cancelled) return
        if (firstRow) setFetched({ key: fetchKey, row: firstRow })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (isResultsExpiredError(error)) {
          markResultsExpired(tabId)
          return
        }
        logFrontend(
          'warn',
          `[result-form-view] could not load row ${clampedIndex + 1}: ${toErrorMessage(error)}`
        )
      })
    return () => {
      cancelled = true
    }
  }, [clampedIndex, fetchKey, fetched, markResultsExpired, needsFetch, resultIndex, tabId])

  return useMemo<CachedRow | null>(() => {
    if (isDraftPosition && draftRow) return { row: draftRow, baseIndex: -1 }
    return loadedRow ?? fetchedRowFor(fetched, fetchKey)
  }, [draftRow, fetchKey, fetched, isDraftPosition, loadedRow])
}

interface RowEditOverlay {
  editState: RowEditState | null
  editingRowIndex: number | null
  editColumnBindings: Map<number, string>
}

interface FormRowDataInputs {
  currentCached: CachedRow | null
  columnCount: number
  clampedIndex: number
  rowEdit: RowEditOverlay
}

function applyEditedValues(rowData: Record<string, unknown>, inputs: FormRowDataInputs): void {
  const edit = inputs.rowEdit
  if (edit.editingRowIndex !== inputs.clampedIndex) return
  if (!edit.editState) return
  const currentValues = edit.editState.currentValues
  for (let columnIndex = 0; columnIndex < inputs.columnCount; columnIndex++) {
    const boundName = edit.editColumnBindings.get(columnIndex)
    const hasEditedValue = boundName !== undefined && boundName in currentValues
    if (hasEditedValue) {
      rowData[columnKey(columnIndex)] = currentValues[boundName]
    }
  }
}

function buildFormRowData(inputs: FormRowDataInputs): Record<string, unknown> | null {
  const currentRow = inputs.currentCached?.row ?? null
  if (currentRow === null) return null

  const rowData: Record<string, unknown> = {
    __rowIdx: inputs.clampedIndex,
    __baseIdx: inputs.currentCached?.baseIndex ?? -1,
  }
  for (let columnIndex = 0; columnIndex < inputs.columnCount; columnIndex++) {
    rowData[columnKey(columnIndex)] = currentRow[columnIndex] ?? null
  }
  applyEditedValues(rowData, inputs)
  return rowData
}

function columnKeyFlags(meta: TableDataColumnMeta | undefined) {
  return {
    isNullable: meta?.isNullable ?? false,
    isPrimaryKey: meta?.isPrimaryKey ?? false,
    isUniqueKey: meta?.isUniqueKey ?? false,
  }
}

interface DescriptorContext {
  isEditing: boolean
  editColumnBindings: Map<number, string>
}

function toGridColumnDescriptor(
  column: ResolvedColumn,
  columnIndex: number,
  context: DescriptorContext
): GridColumnDescriptor {
  const meta = column.tableColumnMeta
  const isBinary = meta?.isBinary ?? isBinaryDataType(column.dataType)
  const isBoundForEdit = context.isEditing && context.editColumnBindings.has(columnIndex)
  return {
    key: column.key,
    displayName: column.displayName,
    dataType: meta?.dataType ?? column.dataType,
    editable: column.editable,
    isBinary: isBinary,
    blobViewer: isBinary,
    blobViewerEditable: isBinary && isBoundForEdit,
    ...columnKeyFlags(meta),
    enumValues: meta?.enumValues,
    tableColumnMeta: meta,
    foreignKey: column.foreignKey,
  }
}

function toSharedEditState(
  editState: RowEditState,
  columnCount: number,
  editColumnBindings: Map<number, string>
): SharedRowEditState {
  const currentValues: Record<string, unknown> = {}
  const originalValues: Record<string, unknown> = {}

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
    const columnName = editColumnBindings.get(columnIndex)
    if (!columnName) continue
    const key = columnKey(columnIndex)
    if (columnName in editState.currentValues) {
      currentValues[key] = editState.currentValues[columnName]
    }
    if (columnName in editState.originalValues) {
      originalValues[key] = editState.originalValues[columnName]
    }
  }

  return {
    rowKey: JSON.stringify(editState.rowKey),
    currentValues: currentValues,
    originalValues: originalValues,
  }
}

interface BlobContext extends QueryResultBlobContext {
  columnIndex: number
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResultFormView(props: ResultFormViewProps) {
  const { columns, onNavigate, onStartEdit, onUpdateCell, onSaveRow, onDiscardRow } = props
  const edit = resolveFormEditProps(props)
  const { editMode, editState, editingRowIndex, editColumnBindings } = edit
  const position = resolveFormRowPosition(props)
  const { totalRows, currentIndex, clampedIndex } = position

  const currentCached = useFormCurrentRow(props, position)
  const currentRow = currentCached?.row ?? null
  const currentRowData = useMemo(
    () =>
      buildFormRowData({
        currentCached: currentCached,
        columnCount: columns.length,
        clampedIndex: clampedIndex,
        rowEdit: {
          editState: editState,
          editingRowIndex: editingRowIndex,
          editColumnBindings: editColumnBindings,
        },
      }),
    [columns, currentCached, editState, editingRowIndex, clampedIndex, editColumnBindings]
  )

  const isInEditMode = editMode !== null
  const isEditingCurrentRow = editState !== null && editingRowIndex === clampedIndex
  const [blobContext, setBlobContext] = useState<BlobContext | null>(null)

  const resolvedColumns = useMemo(
    () =>
      resolveQueryResultColumns({
        resultColumns: columns,
        editMode: editMode,
        editableColumnMap: edit.editableColumnMap,
        editTableColumns: edit.editTableColumns,
        editForeignKeys: edit.editForeignKeys,
        editColumnBindings: editColumnBindings,
      }),
    [
      columns,
      editMode,
      edit.editableColumnMap,
      edit.editTableColumns,
      edit.editForeignKeys,
      editColumnBindings,
    ]
  )

  // --- Transform columns → GridColumnDescriptor[] ---

  const gridColumns: GridColumnDescriptor[] = useMemo(() => {
    const context = { isEditing: editMode !== null, editColumnBindings: editColumnBindings }
    return resolvedColumns.map((column, columnIndex) =>
      toGridColumnDescriptor(column, columnIndex, context)
    )
  }, [editColumnBindings, editMode, resolvedColumns])

  // --- Transform edit state: remap real column name keys → col_N keys ---

  const sharedEditState: SharedRowEditState | null = useMemo(() => {
    if (!isEditingCurrentRow) return null
    if (!editState) return null
    return toSharedEditState(editState, columns.length, editColumnBindings)
  }, [isEditingCurrentRow, editState, columns, editColumnBindings])

  // --- Edit callbacks (translate col_N → real column name) ---

  const handleUpdateCell = useCallback(
    (changedColumnKey: string, value: unknown) => {
      const columnIndex = columnIndexFromKey(changedColumnKey)
      if (columns[columnIndex]) {
        onUpdateCell?.(columnIndex, value)
      }
    },
    [columns, onUpdateCell]
  )

  const handleEnsureEditing = useCallback(() => {
    if (!isInEditMode) return
    if (!onStartEdit) return
    if (editingRowIndex !== clampedIndex) {
      onStartEdit(clampedIndex, currentCached ?? undefined)
    }
  }, [isInEditMode, onStartEdit, editingRowIndex, clampedIndex, currentCached])

  const handleSave = useCallback(async () => {
    if (onSaveRow) {
      await onSaveRow()
    }
  }, [onSaveRow])

  const handleDiscard = useCallback(() => {
    onDiscardRow?.()
  }, [onDiscardRow])

  const handleBlobView = useCallback(
    (column: GridColumnDescriptor, rowData: Record<string, unknown> | null) => {
      const columnIndex = columnIndexFromKey(column.key)
      const cellValue = rowData?.[column.key]
      setBlobContext({
        columnIndex: columnIndex,
        columnLabel: column.displayName,
        base64: typeof cellValue === 'string' ? cellValue : null,
        editable: column.blobViewerEditable === true,
      })
    },
    []
  )

  const closeBlobDialog = useCallback(() => {
    setBlobContext(null)
  }, [])

  const handleBlobApply = useCallback(
    (envelope: BlobEnvelope) => {
      if (!blobContext?.editable) return
      if (editingRowIndex !== clampedIndex) {
        onStartEdit?.(clampedIndex, currentCached ?? undefined)
      }
      onUpdateCell?.(blobContext.columnIndex, envelope)
    },
    [blobContext, clampedIndex, currentCached, editingRowIndex, onStartEdit, onUpdateCell]
  )

  // --- Navigation with auto-save-before-navigate ---

  const navigateWithAutoSave = useCallback(
    async (direction: 'prev' | 'next') => {
      const pendingEdit = isInEditMode ? editState : null
      const canSaveBeforeNavigating = hasModifiedColumns(pendingEdit) && onSaveRow !== undefined
      if (canSaveBeforeNavigating) {
        const saved = await onSaveRow()
        if (saved) onNavigate(direction)
        return
      }
      if (pendingEdit) onDiscardRow?.()
      onNavigate(direction)
    },
    [isInEditMode, editState, onSaveRow, onDiscardRow, onNavigate]
  )

  const handleNavigatePrevious = useCallback(
    () => navigateWithAutoSave('prev'),
    [navigateWithAutoSave]
  )

  const handleNavigateNext = useCallback(() => navigateWithAutoSave('next'), [navigateWithAutoSave])

  const editHandlers = isInEditMode
    ? {
        onEnsureEditing: handleEnsureEditing,
        onUpdateCell: handleUpdateCell,
        onSave: handleSave,
        onDiscard: handleDiscard,
      }
    : {}

  // --- Render ---

  return (
    <>
      <BaseFormView
        columns={gridColumns}
        currentRow={currentRow}
        currentRowData={currentRowData}
        totalRows={totalRows}
        currentAbsoluteIndex={currentIndex}
        isFirstRecord={currentIndex <= 0}
        isLastRecord={currentIndex >= totalRows - 1}
        onNavigatePrev={handleNavigatePrevious}
        onNavigateNext={handleNavigateNext}
        editState={sharedEditState}
        {...editHandlers}
        readOnly={!isInEditMode}
        testId="result-form-view"
        onBlobView={handleBlobView}
      />
      <QueryResultBlobDialog
        blobContext={blobContext}
        onClose={closeBlobDialog}
        onApply={handleBlobApply}
      />
    </>
  )
}
