import { useCallback, useMemo, type RefObject } from 'react'
import { columnIndexFromKey } from '../../../lib/col-key-utils'
import { toCachedRow } from '../../../lib/result-row-materializer'
import { hasModifiedColumns } from '../../../lib/row-edit-state'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import type { EditorCallbacksContextType } from '../../shared/editor-callbacks-context'
import type { CachedRow } from '../../../lib/result-window-cache'
import type { ColumnMeta, RowEditState } from '../../../types/schema'
import type {
  CellClickGuardArgs,
  CellClickGuardResult,
  CellClipboardEditArgs,
} from '../../../types/shared-data-view'
import { isEditingRowData, type ResultGridViewProps } from './result-grid-model'

type EditingProps = Pick<
  ResultGridViewProps,
  | 'tabId'
  | 'editMode'
  | 'editableColumnMap'
  | 'editState'
  | 'editingRowIndex'
  | 'editingBaseIndex'
  | 'editColumnBindings'
  | 'onStartEditing'
  | 'onUpdateCellValue'
  | 'onSyncCellValue'
  | 'onAutoSave'
>

type SyncSelection = (rowIndex: number, columnKey: string, row: Record<string, unknown>) => void

export interface ResultGridEditingInputs extends EditingProps {
  columns: ColumnMeta[]
  columnsRef: RefObject<ColumnMeta[]>
  syncSelection: SyncSelection
}

interface EditingRowRefs {
  editStateRef: RefObject<RowEditState | null>
  editingRowIndexRef: RefObject<number | null>
  editingBaseIndexRef: RefObject<number | null>
}

type AutoSave = (targetRowIndex: number) => Promise<boolean>

function useEditorCallbacksContext(inputs: ResultGridEditingInputs): EditorCallbacksContextType {
  const { tabId, onUpdateCellValue } = inputs
  return useMemo(
    () => ({
      tabId: tabId,
      updateCellValue: (_tabId, editedColumnKey, value) => {
        const columnIndex = columnIndexFromKey(editedColumnKey)
        if (columnIndex >= 0) onUpdateCellValue(columnIndex, value)
      },
      syncCellValue: () => {},
    }),
    [onUpdateCellValue, tabId]
  )
}

function useEditingRowRefs(inputs: ResultGridEditingInputs): EditingRowRefs {
  const editStateRef = useLatestRef(inputs.editState)
  const editingRowIndexRef = useLatestRef(inputs.editingRowIndex)
  const editingBaseIndexRef = useLatestRef(inputs.editingBaseIndex)
  return useMemo(
    () => ({ editStateRef, editingRowIndexRef, editingBaseIndexRef }),
    [editStateRef, editingRowIndexRef, editingBaseIndexRef]
  )
}

function isModifiedBoundCell(refs: EditingRowRefs, rowData: Record<string, unknown>) {
  const currentEditState = refs.editStateRef.current
  const currentEditingRowIndex = refs.editingRowIndexRef.current
  if (!currentEditState) return null
  if (currentEditingRowIndex === null) return null
  const editingBaseIndex = refs.editingBaseIndexRef.current
  if (!isEditingRowData(rowData, currentEditingRowIndex, editingBaseIndex)) return null
  return currentEditState
}

function useIsModifiedCell(inputs: ResultGridEditingInputs, refs: EditingRowRefs) {
  const { editMode, editColumnBindings } = inputs
  return useCallback(
    (rowData: Record<string, unknown>, cellColumnKey: string) => {
      if (!editMode) return false
      const editingRowState = isModifiedBoundCell(refs, rowData)
      if (!editingRowState) return false
      const boundName = editColumnBindings.get(columnIndexFromKey(cellColumnKey))
      if (!boundName) return false
      return editingRowState.modifiedColumns.has(boundName)
    },
    [editMode, editColumnBindings, refs]
  )
}

function useAutoSaveBeforeLeavingEditedRow(
  onAutoSave: () => Promise<boolean>,
  refs: EditingRowRefs
): AutoSave {
  const { editingRowIndexRef, editStateRef } = refs
  return useCallback(
    async (targetRowIndex: number): Promise<boolean> => {
      const currentEditingRow = editingRowIndexRef.current
      if (currentEditingRow === null) return true
      if (currentEditingRow === targetRowIndex) return true
      if (!hasModifiedColumns(editStateRef.current)) return true
      return onAutoSave()
    },
    [onAutoSave, editingRowIndexRef, editStateRef]
  )
}

interface EditGuardContext {
  editableColumnMap: Map<number, boolean>
  onStartEditing: (rowIndex: number, row?: CachedRow) => void
  syncSelection: SyncSelection
  columnsRef: RefObject<ColumnMeta[]>
  editingRowIndexRef: RefObject<number | null>
  autoSave: AutoSave
}

async function runEditCellClickGuard(
  context: EditGuardContext,
  args: CellClickGuardArgs
): Promise<CellClickGuardResult> {
  const { rowIdx: rowIndex, columnKey: clickedColumnKey } = args
  const targetColumnIndex = columnIndexFromKey(clickedColumnKey)
  const isEditable = context.editableColumnMap.get(targetColumnIndex) ?? false
  const currentEditingRow = context.editingRowIndexRef.current
  const saveSucceeded = await context.autoSave(rowIndex)
  if (!saveSucceeded) {
    return {
      proceed: false,
      targetRowIdx: currentEditingRow ?? rowIndex,
      targetColIdx: targetColumnIndex,
      enableEditor: args.source !== 'keyboard',
      restoreFocus: true,
    }
  }
  context.syncSelection(rowIndex, clickedColumnKey, args.rowData)
  if (!isEditable) {
    return {
      proceed: true,
      targetRowIdx: rowIndex,
      targetColIdx: targetColumnIndex,
      enableEditor: false,
    }
  }
  if (currentEditingRow !== rowIndex) {
    context.onStartEditing(rowIndex, toCachedRow(args.rowData, context.columnsRef.current.length))
  }
  return {
    proceed: true,
    targetRowIdx: rowIndex,
    targetColIdx: targetColumnIndex,
    enableEditor: args.source === 'keyboard-typing',
  }
}

function useEditCellClickGuard(
  inputs: ResultGridEditingInputs,
  refs: EditingRowRefs,
  autoSave: AutoSave
) {
  const { editMode, editableColumnMap, onStartEditing, syncSelection, columnsRef } = inputs
  const { editingRowIndexRef } = refs
  return useMemo(() => {
    if (!editMode) return undefined
    const context: EditGuardContext = {
      editableColumnMap: editableColumnMap,
      onStartEditing: onStartEditing,
      syncSelection: syncSelection,
      columnsRef: columnsRef,
      editingRowIndexRef: editingRowIndexRef,
      autoSave: autoSave,
    }
    return (args: CellClickGuardArgs) => runEditCellClickGuard(context, args)
  }, [
    autoSave,
    editMode,
    editableColumnMap,
    onStartEditing,
    syncSelection,
    columnsRef,
    editingRowIndexRef,
  ])
}

function useReadOnlyCellClickGuard(syncSelection: SyncSelection) {
  return useCallback(
    async (args: CellClickGuardArgs): Promise<CellClickGuardResult> => {
      syncSelection(args.rowIdx, args.columnKey, args.rowData)
      const targetColumnIndex = columnIndexFromKey(args.columnKey)
      return {
        proceed: true,
        targetRowIdx: args.rowIdx,
        targetColIdx: targetColumnIndex >= 0 ? targetColumnIndex : 0,
        enableEditor: false,
      }
    },
    [syncSelection]
  )
}

function clipboardCellValue(args: CellClipboardEditArgs): unknown {
  if (args.action === 'cut') return null
  return args.text ?? args.rowData[args.columnKey]
}

function isEditableResultColumn(
  columns: ColumnMeta[],
  editableColumnMap: Map<number, boolean>,
  columnIndex: number
): boolean {
  if (!columns[columnIndex]) return false
  return editableColumnMap.get(columnIndex) ?? false
}

function useCellClipboardEdit(
  inputs: ResultGridEditingInputs,
  refs: EditingRowRefs,
  autoSave: AutoSave
) {
  const { editMode, columns, editableColumnMap, onStartEditing, onSyncCellValue, syncSelection } =
    inputs
  const { editingRowIndexRef } = refs
  return useCallback(
    async (args: CellClipboardEditArgs): Promise<boolean> => {
      if (!editMode) return false
      const columnIndex = columnIndexFromKey(args.columnKey)
      if (!isEditableResultColumn(columns, editableColumnMap, columnIndex)) return false
      const currentEditingRow = editingRowIndexRef.current
      const saveSucceeded = await autoSave(args.rowIdx)
      if (!saveSucceeded) return false
      syncSelection(args.rowIdx, args.columnKey, args.rowData)
      if (currentEditingRow !== args.rowIdx) {
        onStartEditing(args.rowIdx, toCachedRow(args.rowData, columns.length))
      }
      onSyncCellValue(columnIndex, clipboardCellValue(args))
      return true
    },
    [
      editMode,
      columns,
      editableColumnMap,
      autoSave,
      onStartEditing,
      onSyncCellValue,
      syncSelection,
      editingRowIndexRef,
    ]
  )
}

export function useResultGridEditing(inputs: ResultGridEditingInputs) {
  const refs = useEditingRowRefs(inputs)
  const autoSave = useAutoSaveBeforeLeavingEditedRow(inputs.onAutoSave, refs)
  return {
    editorCallbacksContext: useEditorCallbacksContext(inputs),
    isModifiedCell: useIsModifiedCell(inputs, refs),
    autoSaveBeforeLeavingEditedRow: autoSave,
    cellClickGuard: useEditCellClickGuard(inputs, refs, autoSave),
    readOnlyCellClickGuard: useReadOnlyCellClickGuard(inputs.syncSelection),
    handleCellClipboardEdit: useCellClipboardEdit(inputs, refs, autoSave),
  }
}
