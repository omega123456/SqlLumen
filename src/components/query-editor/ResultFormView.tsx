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
import { useQueryStore } from '../../stores/query-store'
import { BaseFormView } from '../shared/BaseFormView'
import { colKey, colIndexFromKey, buildTableColLookup } from '../../lib/col-key-utils'
import type {
  GridColumnDescriptor,
  RowEditState as SharedRowEditState,
} from '../../types/shared-data-view'
import type { ColumnMeta, TableDataColumnMeta, RowEditState } from '../../types/schema'

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
  /** Start editing a row by its page-local index. */
  onStartEdit?: (rowIndex: number) => void
  /** Update a cell value in the edit state. */
  onUpdateCell?: (columnName: string, value: unknown) => void
  /** Save current row. */
  onSaveRow?: () => Promise<boolean>
  /** Discard current row edits. */
  onDiscardRow?: () => void
}

const EMPTY_EDITABLE_MAP = new Map<number, boolean>()
const EMPTY_TABLE_COLUMNS: TableDataColumnMeta[] = []

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResultFormView({
  columns,
  rows,
  selectedRowIndex,
  totalRows,
  currentPage,
  totalPages,
  onNavigate,
  tabId,
  editMode = null,
  editableColumnMap = EMPTY_EDITABLE_MAP,
  editState = null,
  editingRowIndex = null,
  editTableColumns = EMPTY_TABLE_COLUMNS,
  onStartEdit,
  onUpdateCell,
  onSaveRow,
  onDiscardRow,
}: ResultFormViewProps) {
  // Read pageSize from the store to compute page-local row offset
  const pageSize = useQueryStore((state) => state.tabs[tabId]?.pageSize ?? 1000)

  const absoluteIndex = selectedRowIndex ?? 0

  // Map absolute index → page-local index
  const pageStartOffset = (currentPage - 1) * pageSize
  const localIndex = absoluteIndex - pageStartOffset
  const clampedLocal = Math.max(0, Math.min(localIndex, rows.length - 1))
  const currentRow = rows.length > 0 ? ((rows[clampedLocal] as unknown[]) ?? null) : null

  const isInEditMode = editMode !== null
  const isEditingCurrentRow = editState !== null && editingRowIndex === clampedLocal

  // Suppress lint: totalPages is used for display / future guard
  void totalPages

  // --- Table column lookup (for column meta enrichment) ---

  const tableColLookup = useMemo(() => buildTableColLookup(editTableColumns), [editTableColumns])

  // --- Transform columns → GridColumnDescriptor[] ---

  const gridColumns: GridColumnDescriptor[] = useMemo(() => {
    return columns.map((col, i) => {
      const tableCol = tableColLookup.get(col.name.toLowerCase())
      const isEditable = isInEditMode && editableColumnMap.get(i) === true
      return {
        key: colKey(i),
        displayName: col.name,
        dataType: tableCol?.dataType ?? col.dataType,
        editable: isEditable,
        isBinary: tableCol?.isBinary ?? false,
        isNullable: tableCol?.isNullable ?? false,
        isPrimaryKey: tableCol?.isPrimaryKey ?? false,
        isUniqueKey: tableCol?.isUniqueKey ?? false,
        enumValues: tableCol?.enumValues,
        tableColumnMeta: tableCol,
      }
    })
  }, [columns, tableColLookup, isInEditMode, editableColumnMap])

  // --- Transform edit state: remap real column name keys → col_N keys ---

  const sharedEditState: SharedRowEditState | null = useMemo(() => {
    if (!isEditingCurrentRow || !editState) return null

    const currentValues: Record<string, unknown> = {}
    const originalValues: Record<string, unknown> = {}

    for (let i = 0; i < columns.length; i++) {
      const colName = columns[i].name
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
  }, [isEditingCurrentRow, editState, columns])

  // --- Edit callbacks (translate col_N → real column name) ---

  const handleUpdateCell = useCallback(
    (colKey_: string, value: unknown) => {
      const colIndex = colIndexFromKey(colKey_)
      const realColName = columns[colIndex]?.name
      if (realColName) {
        onUpdateCell?.(realColName, value)
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

  const handleNavigatePrev = useCallback(async () => {
    if (isInEditMode && editState) {
      if (editState.modifiedColumns.size > 0 && onSaveRow) {
        const success = await onSaveRow()
        if (!success) return
      } else {
        onDiscardRow?.()
      }
    }
    onNavigate('prev')
  }, [isInEditMode, editState, onSaveRow, onDiscardRow, onNavigate])

  const handleNavigateNext = useCallback(async () => {
    if (isInEditMode && editState) {
      if (editState.modifiedColumns.size > 0 && onSaveRow) {
        const success = await onSaveRow()
        if (!success) return
      } else {
        onDiscardRow?.()
      }
    }
    onNavigate('next')
  }, [isInEditMode, editState, onSaveRow, onDiscardRow, onNavigate])

  // --- Render ---

  return (
    <BaseFormView
      columns={gridColumns}
      currentRow={currentRow}
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
