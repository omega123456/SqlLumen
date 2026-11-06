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
import { BlobViewerDialog } from '../dialogs/BlobViewerDialog'
import { colKey, colIndexFromKey } from '../../lib/col-key-utils'
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
// Component
// ---------------------------------------------------------------------------

export function ResultFormView({
  columns,
  resultIndex,
  queryId,
  viewVersion,
  viewRowCount,
  draftRow = null,
  selectedRowIndex,
  onNavigate,
  tabId,
  editMode = null,
  editableColumnMap = EMPTY_EDITABLE_MAP,
  editState = null,
  editingRowIndex = null,
  editTableColumns = EMPTY_TABLE_COLUMNS,
  editForeignKeys = EMPTY_FOREIGN_KEYS,
  editColumnBindings = EMPTY_BINDINGS,
  onStartEdit,
  onUpdateCell,
  onSaveRow,
  onDiscardRow,
}: ResultFormViewProps) {
  // Form view can render the first row as a visual fallback before store selection exists.
  // Clone enablement is handled upstream by checking whether selectedRowIndex is committed.
  const totalRows = viewRowCount + (draftRow ? 1 : 0)
  const currentIndex = selectedRowIndex ?? 0
  const clampedIndex = Math.max(0, Math.min(currentIndex, totalRows - 1))
  const markResultsExpired = useQueryStore((state) => state.markResultsExpired)

  // Re-render when the page holding the current row loads or is patched.
  const [windowTick, setWindowTick] = useState(0)
  useEffect(
    () =>
      subscribeToResultWindow(tabId, resultIndex, ([start, end]) => {
        if (clampedIndex >= start && clampedIndex < end) setWindowTick((tick) => tick + 1)
      }),
    [clampedIndex, resultIndex, tabId]
  )

  // A row outside the loaded pages is fetched by view range.
  const fetchKey = `${queryId ?? ''}:${viewVersion}:${clampedIndex}`
  const [fetched, setFetched] = useState<{ key: string; row: CachedRow } | null>(null)
  // A saved edit of the fetched row (which isn't in the page cache) patches it here.
  useEffect(
    () =>
      subscribeToRowPatches(tabId, resultIndex, (baseIndex, apply) => {
        setFetched((current) =>
          current && current.row.baseIndex === baseIndex
            ? { ...current, row: { baseIndex, row: apply(current.row.row) } }
            : current
        )
      }),
    [resultIndex, tabId]
  )
  const isDraftPosition = draftRow !== null && clampedIndex === viewRowCount
  const loadedRow = useMemo(() => {
    void windowTick
    if (isDraftPosition || totalRows === 0) return null
    return getLoadedRow(tabId, resultIndex, clampedIndex) ?? null
  }, [clampedIndex, isDraftPosition, resultIndex, tabId, totalRows, windowTick])
  const needsFetch = !isDraftPosition && totalRows > 0 && loadedRow === null
  useEffect(() => {
    if (!needsFetch || fetched?.key === fetchKey) return
    let cancelled = false
    readViewRange(tabId, resultIndex, [clampedIndex, clampedIndex + 1])
      .then((rows) => {
        if (!cancelled && rows[0]) setFetched({ key: fetchKey, row: rows[0] })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (isResultsExpiredError(error)) {
          markResultsExpired(tabId)
          return
        }
        logFrontend(
          'warn',
          `[result-form-view] could not load row ${clampedIndex + 1}: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      })
    return () => {
      cancelled = true
    }
  }, [clampedIndex, fetchKey, fetched, markResultsExpired, needsFetch, resultIndex, tabId])

  const currentCached = useMemo<CachedRow | null>(
    () =>
      isDraftPosition
        ? { row: draftRow, baseIndex: -1 }
        : (loadedRow ?? (fetched?.key === fetchKey ? fetched.row : null)),
    [draftRow, fetchKey, fetched, isDraftPosition, loadedRow]
  )
  const currentRow = currentCached?.row ?? null
  const currentRowData = useMemo(() => {
    if (currentRow === null) return null

    const rowData: Record<string, unknown> = {
      __rowIdx: clampedIndex,
      __baseIdx: currentCached?.baseIndex ?? -1,
    }
    for (let i = 0; i < columns.length; i++) {
      rowData[colKey(i)] = currentRow[i] ?? null
    }

    if (editingRowIndex === clampedIndex && editState) {
      for (let i = 0; i < columns.length; i++) {
        const boundName = editColumnBindings.get(i)
        if (boundName && boundName in editState.currentValues) {
          rowData[colKey(i)] = editState.currentValues[boundName]
        }
      }
    }

    return rowData
  }, [
    columns,
    currentCached?.baseIndex,
    currentRow,
    editState,
    editingRowIndex,
    clampedIndex,
    editColumnBindings,
  ])

  const isInEditMode = editMode !== null
  const isEditingCurrentRow = editState !== null && editingRowIndex === clampedIndex
  const [blobDialogOpen, setBlobDialogOpen] = useState(false)
  const [blobContext, setBlobContext] = useState<{
    columnIndex: number
    columnLabel: string
    base64: string | null
    editable: boolean
  } | null>(null)

  void tabId

  const resolvedColumns = useMemo(
    () =>
      resolveQueryResultColumns({
        resultColumns: columns,
        editMode,
        editableColumnMap,
        editTableColumns,
        editForeignKeys,
        editColumnBindings,
      }),
    [columns, editMode, editableColumnMap, editTableColumns, editForeignKeys, editColumnBindings]
  )

  // --- Transform columns → GridColumnDescriptor[] ---

  const gridColumns: GridColumnDescriptor[] = useMemo(() => {
    return resolvedColumns.map((col, colIdx) => {
      const isBinary = col.tableColumnMeta?.isBinary ?? isBinaryDataType(col.dataType)
      return {
        key: col.key,
        displayName: col.displayName,
        dataType: col.tableColumnMeta?.dataType ?? col.dataType,
        editable: col.editable,
        isBinary,
        blobViewer: isBinary,
        blobViewerEditable: isBinary && editMode !== null && editColumnBindings.has(colIdx),
        isNullable: col.tableColumnMeta?.isNullable ?? false,
        isPrimaryKey: col.tableColumnMeta?.isPrimaryKey ?? false,
        isUniqueKey: col.tableColumnMeta?.isUniqueKey ?? false,
        enumValues: col.tableColumnMeta?.enumValues,
        tableColumnMeta: col.tableColumnMeta,
        foreignKey: col.foreignKey,
      }
    })
  }, [editColumnBindings, editMode, resolvedColumns])

  // --- Transform edit state: remap real column name keys → col_N keys ---

  const sharedEditState: SharedRowEditState | null = useMemo(() => {
    if (!isEditingCurrentRow || !editState) return null

    const currentValues: Record<string, unknown> = {}
    const originalValues: Record<string, unknown> = {}

    for (let i = 0; i < columns.length; i++) {
      const colName = editColumnBindings.get(i)
      if (!colName) continue
      const key = colKey(i)
      if (colName in editState.currentValues) {
        currentValues[key] = editState.currentValues[colName]
      }
      if (colName in editState.originalValues) {
        originalValues[key] = editState.originalValues[colName]
      }
    }

    return {
      rowKey: JSON.stringify(editState.rowKey),
      currentValues,
      originalValues,
    }
  }, [isEditingCurrentRow, editState, columns, editColumnBindings])

  // --- Edit callbacks (translate col_N → real column name) ---

  const handleUpdateCell = useCallback(
    (colKey_: string, value: unknown) => {
      const colIndex = colIndexFromKey(colKey_)
      if (columns[colIndex]) {
        onUpdateCell?.(colIndex, value)
      }
    },
    [columns, onUpdateCell]
  )

  const handleEnsureEditing = useCallback(() => {
    if (!isInEditMode || !onStartEdit) return
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
      const columnIndex = colIndexFromKey(column.key)
      const cellValue = rowData?.[column.key]
      setBlobContext({
        columnIndex,
        columnLabel: column.displayName,
        base64: typeof cellValue === 'string' ? cellValue : null,
        editable: column.blobViewerEditable === true,
      })
      setBlobDialogOpen(true)
    },
    []
  )

  const closeBlobDialog = useCallback(() => {
    setBlobDialogOpen(false)
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
      if (isInEditMode && editState) {
        if (editState.modifiedColumns.size > 0 && onSaveRow) {
          const success = await onSaveRow()
          if (!success) return
        } else {
          onDiscardRow?.()
        }
      }
      onNavigate(direction)
    },
    [isInEditMode, editState, onSaveRow, onDiscardRow, onNavigate]
  )

  const handleNavigatePrev = useCallback(() => navigateWithAutoSave('prev'), [navigateWithAutoSave])

  const handleNavigateNext = useCallback(() => navigateWithAutoSave('next'), [navigateWithAutoSave])

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
        onNavigatePrev={handleNavigatePrev}
        onNavigateNext={handleNavigateNext}
        editState={sharedEditState}
        onEnsureEditing={isInEditMode ? handleEnsureEditing : undefined}
        onUpdateCell={isInEditMode ? handleUpdateCell : undefined}
        onSave={isInEditMode ? handleSave : undefined}
        onDiscard={isInEditMode ? handleDiscard : undefined}
        readOnly={!isInEditMode}
        testId="result-form-view"
        onBlobView={handleBlobView}
      />
      {blobDialogOpen && blobContext && (
        <BlobViewerDialog
          isOpen={blobDialogOpen}
          onClose={closeBlobDialog}
          mode={blobContext.editable ? 'edit' : 'view'}
          columnLabel={blobContext.columnLabel}
          initialBase64={blobContext.base64}
          onApply={blobContext.editable ? handleBlobApply : undefined}
        />
      )}
    </>
  )
}
