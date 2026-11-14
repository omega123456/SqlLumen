import { useCallback, useState } from 'react'
import { columnIndexFromKey } from '../../../lib/col-key-utils'
import type { CachedRow } from '../../../lib/result-window-cache'
import { hasModifiedColumns } from '../../../lib/row-edit-state'
import type { BlobEnvelope, ColumnMeta, RowEditState } from '../../../types/schema'
import type { GridColumnDescriptor } from '../../../types/shared-data-view'
import type { BlobContext, ResultFormViewProps } from './result-form-model'

export interface FormRowTarget {
  columns: ColumnMeta[]
  isInEditMode: boolean
  editState: RowEditState | null
  editingRowIndex: number | null
  clampedIndex: number
  currentCached: CachedRow | null
}

type FormCallbacks = Pick<
  ResultFormViewProps,
  'onNavigate' | 'onStartEdit' | 'onUpdateCell' | 'onSaveRow' | 'onDiscardRow'
>

function useFormEditHandlers(target: FormRowTarget, callbacks: FormCallbacks) {
  const { columns, isInEditMode, editingRowIndex, clampedIndex, currentCached } = target
  const { onStartEdit, onUpdateCell, onSaveRow, onDiscardRow } = callbacks

  const handleUpdateCell = useCallback(
    (changedColumnKey: string, value: unknown) => {
      const columnIndex = columnIndexFromKey(changedColumnKey)
      if (columns[columnIndex]) onUpdateCell?.(columnIndex, value)
    },
    [columns, onUpdateCell]
  )

  const handleEnsureEditing = useCallback(() => {
    if (!isInEditMode) return
    if (!onStartEdit) return
    if (editingRowIndex !== clampedIndex) onStartEdit(clampedIndex, currentCached ?? undefined)
  }, [isInEditMode, onStartEdit, editingRowIndex, clampedIndex, currentCached])

  const handleSave = useCallback(async () => {
    if (onSaveRow) await onSaveRow()
  }, [onSaveRow])

  const handleDiscard = useCallback(() => {
    onDiscardRow?.()
  }, [onDiscardRow])

  if (!isInEditMode) return {}
  return {
    onEnsureEditing: handleEnsureEditing,
    onUpdateCell: handleUpdateCell,
    onSave: handleSave,
    onDiscard: handleDiscard,
  }
}

function useFormBlobViewer(target: FormRowTarget, callbacks: FormCallbacks) {
  const { editingRowIndex, clampedIndex, currentCached } = target
  const { onStartEdit, onUpdateCell } = callbacks
  const [blobContext, setBlobContext] = useState<BlobContext | null>(null)

  const handleBlobView = useCallback(
    (column: GridColumnDescriptor, rowData: Record<string, unknown> | null) => {
      const cellValue = rowData?.[column.key]
      setBlobContext({
        columnIndex: columnIndexFromKey(column.key),
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

  return { blobContext, handleBlobView, closeBlobDialog, handleBlobApply }
}

function useFormNavigation(target: FormRowTarget, callbacks: FormCallbacks) {
  const { isInEditMode, editState } = target
  const { onSaveRow, onDiscardRow, onNavigate } = callbacks

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

  return {
    handleNavigatePrevious: useCallback(() => navigateWithAutoSave('prev'), [navigateWithAutoSave]),
    handleNavigateNext: useCallback(() => navigateWithAutoSave('next'), [navigateWithAutoSave]),
  }
}

export function useResultFormHandlers(target: FormRowTarget, callbacks: FormCallbacks) {
  return {
    editHandlers: useFormEditHandlers(target, callbacks),
    blobViewer: useFormBlobViewer(target, callbacks),
    navigation: useFormNavigation(target, callbacks),
  }
}
