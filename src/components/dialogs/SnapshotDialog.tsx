import { useCallback, useState } from 'react'
import { CameraPlusIcon } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { DialogShell } from './DialogShell'
import { useSnapshotStore } from '../../stores/snapshot-store'
import { useConnectionStore } from '../../stores/connection-store'
import type { SnapshotSummary } from '../../lib/session-snapshot-commands'
import { SnapshotConfirmDialogs, type ConfirmState } from './snapshot-dialog/SnapshotConfirmDialogs'
import { SnapshotList } from './snapshot-dialog/SnapshotList'
import { joinClassNames } from '../../lib/class-names'
import {
  DIALOG_HEADER,
  DIALOG_HEADER_TITLE,
  DIALOG_PANEL_FOOTER,
} from '../../lib/class-names-dialog'

const BUTTON_ICON_SIZE = 16

function useSnapshotConfirm() {
  const snapshots = useSnapshotStore((state) => state.snapshots)
  const selectedSnapshotId = useSnapshotStore((state) => state.selectedSnapshotId)
  const createManualSnapshot = useSnapshotStore((state) => state.createManualSnapshot)
  const restoreSnapshot = useSnapshotStore((state) => state.restoreSnapshot)
  const deleteSnapshot = useSnapshotStore((state) => state.deleteSnapshot)
  const [confirm, setConfirm] = useState<ConfirmState>(null)

  const requestRestore = useCallback(() => {
    const snapshot = snapshots.find((summary) => summary.id === selectedSnapshotId)
    if (selectedSnapshotId == null) return
    if (!snapshot) return
    const unsavedCount = useConnectionStore.getState().connectionsWithUnsavedEdits().length
    setConfirm({ kind: 'restore', snapshot: snapshot, unsavedCount: unsavedCount })
  }, [selectedSnapshotId, snapshots])

  const runConfirmed = useCallback(async () => {
    if (!confirm) return
    if (confirm.kind === 'create') {
      await createManualSnapshot()
      setConfirm(null)
      return
    }
    if (confirm.kind === 'restore') {
      await restoreSnapshot(confirm.snapshot.id)
      setConfirm(null)
      return
    }
    await deleteSnapshot(confirm.snapshot.id)
    setConfirm(null)
  }, [confirm, createManualSnapshot, restoreSnapshot, deleteSnapshot])

  return {
    confirm: confirm,
    requestCreate: useCallback(() => setConfirm({ kind: 'create' }), []),
    requestRestore: requestRestore,
    requestDelete: useCallback(
      (snapshot: SnapshotSummary) => setConfirm({ kind: 'delete', snapshot: snapshot }),
      []
    ),
    runConfirmed: runConfirmed,
    dismiss: () => setConfirm(null),
  }
}

export function SnapshotDialog() {
  const isDialogOpen = useSnapshotStore((state) => state.isDialogOpen)
  const selectedSnapshotId = useSnapshotStore((state) => state.selectedSnapshotId)
  const isBusy = useSnapshotStore((state) => state.isBusy)
  const isRestoring = useSnapshotStore((state) => state.isRestoring)
  const closeDialog = useSnapshotStore((state) => state.closeDialog)
  const confirmation = useSnapshotConfirm()

  if (!isDialogOpen) {
    return null
  }

  const restoreDisabled = selectedSnapshotId == null || isRestoring

  return (
    <DialogShell
      isOpen={isDialogOpen}
      onClose={closeDialog}
      panelWidth="min(72vw, 780px)"
      panelHeight="min(80vh, 640px)"
      panelPadding={false}
      testId="snapshot-dialog"
      ariaLabel="Session snapshots"
    >
      <div className={joinClassNames([DIALOG_HEADER, 'shrink-0 gap-3'])}>
        <span className={DIALOG_HEADER_TITLE}>Session snapshots</span>
        <Button onClick={confirmation.requestCreate} data-testid="snapshot-create-button">
          <CameraPlusIcon size={BUTTON_ICON_SIZE} />
          Create snapshot
        </Button>
      </div>
      <SnapshotList onCreate={confirmation.requestCreate} onDelete={confirmation.requestDelete} />
      <div className={DIALOG_PANEL_FOOTER}>
        <Button onClick={closeDialog}>Close</Button>
        <Button
          variant="accent"
          disabled={restoreDisabled}
          aria-disabled={restoreDisabled}
          title={restoreDisabled ? 'Select a snapshot to restore' : undefined}
          onClick={confirmation.requestRestore}
          data-testid="snapshot-restore-button"
        >
          Restore snapshot
        </Button>
      </div>
      <SnapshotConfirmDialogs
        confirm={confirmation.confirm}
        isBusy={isBusy}
        isRestoring={isRestoring}
        onConfirm={() => void confirmation.runConfirmed()}
        onDismiss={confirmation.dismiss}
      />
    </DialogShell>
  )
}
