import { ConfirmDialog } from '../../dialogs/ConfirmDialog'
import { CONFIRM_ACTION_COPY, buildPendingWorkSummary } from './pending-work'
import type { UpdateActions } from './use-update-actions'

export function UpdateConfirmDialog({ actions }: { actions: UpdateActions }) {
  const pendingWork = buildPendingWorkSummary()
  const confirmCopy = CONFIRM_ACTION_COPY[actions.confirm.action]
  return (
    <ConfirmDialog
      isOpen={actions.confirm.isOpen}
      title={confirmCopy.title}
      message={
        <div>
          {confirmCopy.intro}
          <ul className="mt-2 list-disc pl-4">
            {pendingWork.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      }
      confirmLabel={confirmCopy.confirmLabel}
      isDestructive
      warningText={null}
      isLoading={actions.isConfirmingAction}
      onConfirm={actions.handleConfirmAction}
      onCancel={actions.closeConfirm}
    />
  )
}
