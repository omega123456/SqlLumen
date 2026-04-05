/**
 * ResultFormView — thin wrapper around BaseFormView for query results.
 *
 * Adapts the query-store shapes (ColumnMeta, RowEditState with modifiedColumns,
 * positional row arrays) into BaseFormView's normalised props (GridColumnDescriptor,
 * shared RowEditState with col_N keys, navigation callbacks with auto-save).
 *
 * The external prop interface is unchanged — ResultPanel passes exactly the
 * same props as before; all adaptation lives inside this wrapper.
 */

import { useCallback, useMemo } from 'react'
import { BaseFormView } from '../shared/BaseFormView'
import { colKey, colIndexFromKey } from '../../lib/col-key-utils'
import { resolveQueryResultColumns } from '../../lib/query-result-column-utils'
import type {
  GridColumnDescriptor,
  RowEditState as SharedRowEditState,
} from '../../types/shared-data-view'
import type {
  ColumnMeta,
  ForeignKeyColumnInfo,
  TableDataColumnMeta,
  RowEditState,
} from '../../types/schema'

// ---------------------------------------------------------------------------
// Props (unchanged external interface)
// ---------------------------------------------------------------------------

export interface ResultFormViewProps {
  columns: ColumnMeta[]
  /** Current page rows — array of arrays, indexed by column position. */
  rows: Array<Array<unknown>>
  /** Absolute index within the full result set (0-based), or null for first row. */
  selectedRowIndex: number | null
  totalRows: number
  currentPage: number
  totalPages: number
  /** Page size for computing local row offset. */
  pageSize: number
  /** Called with 'prev' or 'next' — parent handles page fetching + setSelectedRow. */
  onNavigate: (direction: 'prev' | 'next') => void
  tabId: string

  // --- Edit mode props (optional — null/empty when not in edit mode) ---

  /** Selected table name for editing, or null for read-only. */
  editMode?: string | null
  /** Column index → editable boolean for the selected edit table. */
  editableColumnMap?: Map<number, boolean>
  /** Current row edit state. */
  editState?: RowEditState | null
  /** Page-local row index of the editing row. */
  editingRowIndex?: number | null
  /** Column metadata from the edit table (for cell editor selection). */
  editTableColumns?: TableDataColumnMeta[]
  /** FK metadata from the edit table (single-column constraints only). */
  editForeignKeys?: ForeignKeyColumnInfo[]
  /** Result column index → bound source-table column name. */
  editColumnBindings?: Map<number, string>
  /** Start editing a row by its page-local index. */
  onStartEdit?: (rowIndex: number) => void
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
  rows,
  selectedRowIndex,
  totalRows,
  currentPage,
  totalPages: _totalPages,
  pageSize,
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
  const absoluteIndex = selectedRowIndex ?? 0

  // Map absolute index → page-local index
  const pageStartOffset = (currentPage - 1) * pageSize
  const localIndex = absoluteIndex - pageStartOffset
  const clampedLocal = Math.max(0, Math.min(localIndex, rows.length - 1))
  const currentRow = rows.length > 0 ? ((rows[clampedLocal] as unknown[]) ?? null) : null
  const currentRowData = useMemo(() => {
    if (currentRow === null) return null

    const rowData: Record<string, unknown> = { __rowIdx: clampedLocal }
    for (let i = 0; i < columns.length; i++) {
      rowData[colKey(i)] = currentRow[i] ?? null
    }

    if (editingRowIndex === clampedLocal && editState) {
      for (let i = 0; i < columns.length; i++) {
        const boundName = editColumnBindings.get(i)
        if (boundName && boundName in editState.currentValues) {
          rowData[colKey(i)] = editState.currentValues[boundName]
        }
      }
    }

    return rowData
  }, [columns, currentRow, editState, editingRowIndex, clampedLocal, editColumnBindings])

  const isInEditMode = editMode !== null
  const isEditingCurrentRow = editState !== null && editingRowIndex === clampedLocal

  void _totalPages
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
    return resolvedColumns.map((col) => {
      return {
        key: col.key,
        displayName: col.displayName,
        dataType: col.tableColumnMeta?.dataType ?? col.dataType,
        editable: col.editable,
        isBinary: col.tableColumnMeta?.isBinary ?? false,
        isNullable: col.tableColumnMeta?.isNullable ?? false,
        isPrimaryKey: col.tableColumnMeta?.isPrimaryKey ?? false,
        isUniqueKey: col.tableColumnMeta?.isUniqueKey ?? false,
        enumValues: col.tableColumnMeta?.enumValues,
        tableColumnMeta: col.tableColumnMeta,
        foreignKey: col.foreignKey,
      }
    })
  }, [resolvedColumns])

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
    if (editingRowIndex !== clampedLocal) {
      onStartEdit(clampedLocal)
    }
  }, [isInEditMode, onStartEdit, editingRowIndex, clampedLocal])

  const handleSave = useCallback(async () => {
    if (onSaveRow) {
      await onSaveRow()
    }
  }, [onSaveRow])

  const handleDiscard = useCallback(() => {
    onDiscardRow?.()
  }, [onDiscardRow])

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
    <BaseFormView
      columns={gridColumns}
      currentRow={currentRow}
      currentRowData={currentRowData}
      totalRows={totalRows}
      currentAbsoluteIndex={absoluteIndex}
      isFirstRecord={absoluteIndex <= 0}
      isLastRecord={absoluteIndex >= totalRows - 1}
      onNavigatePrev={handleNavigatePrev}
      onNavigateNext={handleNavigateNext}
      editState={sharedEditState}
      onEnsureEditing={isInEditMode ? handleEnsureEditing : undefined}
      onUpdateCell={isInEditMode ? handleUpdateCell : undefined}
      onSave={isInEditMode ? handleSave : undefined}
      onDiscard={isInEditMode ? handleDiscard : undefined}
      readOnly={!isInEditMode}
      testId="result-form-view"
    />
  )
}
