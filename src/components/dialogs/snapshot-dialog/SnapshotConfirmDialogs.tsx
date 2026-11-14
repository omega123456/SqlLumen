import { ConfirmDialog } from '../ConfirmDialog'
import { formatSnapshotTimestamp } from '../../../lib/snapshot-format'
import type { SnapshotSummary } from '../../../lib/session-snapshot-commands'
import styles from '../SnapshotDialog.module.css'

export type ConfirmState =
  | { kind: 'create' }
  | { kind: 'restore'; snapshot: SnapshotSummary; unsavedCount: number }
  | { kind: 'delete'; snapshot: SnapshotSummary }
  | null

function unsavedChangesWarning(unsavedCount: number): string {
  if (unsavedCount === 1) return '1 connection has unsaved changes that will be lost.'
  return `${unsavedCount} connections have unsaved changes that will be lost.`
}

function RestoreConfirmMessage({ confirm }: { confirm: ConfirmState }) {
  if (confirm?.kind !== 'restore') return null
  return (
    <>
      Replace your current connections and tabs with the state from{' '}
      <strong>{formatSnapshotTimestamp(confirm.snapshot.createdAt)}</strong>?
      {confirm.unsavedCount > 0 && (
        <span className={styles.unsavedWarning}>{unsavedChangesWarning(confirm.unsavedCount)}</span>
      )}
    </>
  )
}

function DeleteConfirmMessage({ confirm }: { confirm: ConfirmState }) {
  if (confirm?.kind !== 'delete') return null
  return (
    <>
      Delete the snapshot from{' '}
      <strong>{formatSnapshotTimestamp(confirm.snapshot.createdAt)}</strong>?
    </>
  )
}

interface SnapshotConfirmDialogsProps {
  confirm: ConfirmState
  isBusy: boolean
  isRestoring: boolean
  onConfirm: () => void
  onDismiss: () => void
}

export function SnapshotConfirmDialogs({
  confirm,
  isBusy,
  isRestoring,
  onConfirm,
  onDismiss,
}: SnapshotConfirmDialogsProps) {
  const confirmKind = confirm?.kind
  const dismissUnlessBusy = () => {
    if (!isBusy) onDismiss()
  }
  const dismissUnlessRestoring = () => {
    if (isBusy) return
    if (isRestoring) return
    onDismiss()
  }

  return (
    <>
      <ConfirmDialog
        isOpen={confirmKind === 'create'}
        title="Create snapshot?"
        message="Capture the current session as a snapshot? This saves your open connections and tabs so you can restore them later."
        confirmLabel="Create snapshot"
        isDestructive={false}
        warningText={null}
        isLoading={isBusy}
        onConfirm={onConfirm}
        onCancel={dismissUnlessBusy}
      />
      <ConfirmDialog
        isOpen={confirmKind === 'restore'}
        title="Restore this snapshot?"
        message={<RestoreConfirmMessage confirm={confirm} />}
        confirmLabel="Restore"
        isDestructive
        warningText="Your current session is saved as a snapshot first, then closed."
        isLoading={isBusy || isRestoring}
        nonDismissible={isRestoring}
        onConfirm={onConfirm}
        onCancel={dismissUnlessRestoring}
      />
      <ConfirmDialog
        isOpen={confirmKind === 'delete'}
        title="Delete snapshot?"
        message={<DeleteConfirmMessage confirm={confirm} />}
        confirmLabel="Delete"
        isDestructive
        warningText={null}
        isLoading={isBusy}
        onConfirm={onConfirm}
        onCancel={dismissUnlessBusy}
      />
    </>
  )
}
