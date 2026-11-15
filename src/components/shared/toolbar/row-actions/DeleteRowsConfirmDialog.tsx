import { ConfirmDialog } from '../../../dialogs/ConfirmDialog'
import type { RowDeletionConfirm } from './use-row-deletion-confirm'

export function DeleteRowsConfirmDialog({ deletion }: { deletion: RowDeletionConfirm }) {
  const { deleteCopy } = deletion
  return (
    <ConfirmDialog
      isOpen={deletion.showDeleteConfirm}
      title={deleteCopy.title}
      message={deleteCopy.message}
      confirmLabel={deleteCopy.confirmLabel}
      isDestructive={deleteCopy.isDestructive}
      warningText={deleteCopy.warningText}
      hideCancel={deleteCopy.blocked}
      onConfirm={deletion.confirmDelete}
      onCancel={deletion.cancelDelete}
    />
  )
}
