import { useCallback, useState } from 'react'
import { getDeleteDialogCopy, type DeleteDialogCopy } from './row-action-model'

export interface RowDeletionConfirmInputs {
  deleteTargetCount: number
  tableName: string
  deleteRows: () => Promise<void>
}

export interface RowDeletionConfirm {
  showDeleteConfirm: boolean
  deleteCopy: DeleteDialogCopy
  requestDelete: () => void
  confirmDelete: () => void
  cancelDelete: () => void
}

export function useRowDeletionConfirm(inputs: RowDeletionConfirmInputs): RowDeletionConfirm {
  const { deleteTargetCount, tableName, deleteRows } = inputs
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const deleteCopy = getDeleteDialogCopy(deleteTargetCount, tableName)

  const requestDelete = useCallback(() => {
    if (deleteTargetCount === 0) return
    setShowDeleteConfirm(true)
  }, [deleteTargetCount])

  const confirmDelete = useCallback(() => {
    setShowDeleteConfirm(false)
    if (deleteTargetCount === 0) return
    if (deleteCopy.blocked) return
    void deleteRows()
  }, [deleteCopy.blocked, deleteRows, deleteTargetCount])

  const cancelDelete = useCallback(() => setShowDeleteConfirm(false), [])

  return { showDeleteConfirm, deleteCopy, requestDelete, confirmDelete, cancelDelete }
}
