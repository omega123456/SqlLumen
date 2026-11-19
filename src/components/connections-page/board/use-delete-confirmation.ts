import { useState } from 'react'
import { useConnectionStore } from '../../../stores/connection-store'
import { showErrorToast, showSuccessToast } from '../../../stores/toast-store'
import { toErrorMessage } from '../../../lib/error-message'

export interface PendingDelete<Item> {
  item: Item
  isDeleting: boolean
  error: string | null
}

export interface DeleteConfirmationSpec<Item> {
  remove: (item: Item) => Promise<void>
  describe: (item: Item) => string
  successTitle: string
  failureTitle: string
}

export function useDeleteConfirmation<Item>(spec: DeleteConfirmationSpec<Item>) {
  const [pendingDelete, setPendingDelete] = useState<PendingDelete<Item> | null>(null)

  const confirmDelete = async () => {
    if (!pendingDelete) return
    const { item } = pendingDelete
    setPendingDelete({ item: item, isDeleting: true, error: null })
    try {
      await spec.remove(item)
      await useConnectionStore.getState().fetchSavedConnections()
      setPendingDelete(null)
      showSuccessToast(spec.successTitle, spec.describe(item))
    } catch (error) {
      const message = toErrorMessage(error)
      setPendingDelete({ item: item, isDeleting: false, error: message })
      showErrorToast(spec.failureTitle, message)
    }
  }

  return {
    pendingDelete: pendingDelete,
    requestDelete: (item: Item) => setPendingDelete({ item: item, isDeleting: false, error: null }),
    cancelDelete: () => setPendingDelete(null),
    confirmDelete: confirmDelete,
  }
}
