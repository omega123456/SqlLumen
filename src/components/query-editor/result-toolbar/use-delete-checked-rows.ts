import { useCallback, useState } from 'react'
import { useQueryStore } from '../../../stores/query-store'
import { getDeleteDialogCopy } from './result-toolbar-model'

export function useDeleteCheckedRows(tabId: string, checkedCount: number, editTableName: string) {
  const deleteResultRows = useQueryStore((state) => state.deleteResultRows)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const deleteCopy = getDeleteDialogCopy(checkedCount, editTableName)

  const handleDeleteChecked = useCallback(() => {
    if (checkedCount === 0) return
    setShowDeleteConfirm(true)
  }, [checkedCount])

  const handleConfirmDelete = useCallback(() => {
    setShowDeleteConfirm(false)
    if (checkedCount === 0) return
    if (deleteCopy.blocked) return
    void deleteResultRows(tabId)
  }, [checkedCount, deleteCopy.blocked, deleteResultRows, tabId])

  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false)
  }, [])

  return {
    showDeleteConfirm,
    deleteCopy,
    handleDeleteChecked,
    handleConfirmDelete,
    handleCancelDelete,
  }
}
