import { useCallback, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { CameraPlusIcon, ClockCounterClockwiseIcon, TrashIcon } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { DialogShell } from './DialogShell'
import { ConfirmDialog } from './ConfirmDialog'
import { useSnapshotStore } from '../../stores/snapshot-store'
import { useConnectionStore } from '../../stores/connection-store'
import {
  formatConnectionBreakdown,
  formatSnapshotCounts,
  formatSnapshotTimestamp,
  formatSnapshotTrigger,
} from '../../lib/snapshot-format'
import type { SnapshotSummary } from '../../lib/session-snapshot-commands'
import styles from './SnapshotDialog.module.css'

type ConfirmState =
  | { kind: 'create' }
  | { kind: 'restore'; snapshot: SnapshotSummary; unsavedCount: number }
  | { kind: 'delete'; snapshot: SnapshotSummary }
  | null

interface SnapshotListPosition {
  currentIndex: number
  snapshotCount: number
}

type SnapshotIndexResolver = (position: SnapshotListPosition) => number

const SNAPSHOT_LIST_KEY_TARGETS: Partial<Record<string, SnapshotIndexResolver>> = {
  ArrowDown: ({ currentIndex }) => (currentIndex < 0 ? 0 : currentIndex + 1),
  ArrowUp: ({ currentIndex, snapshotCount }) =>
    currentIndex < 0 ? snapshotCount - 1 : currentIndex - 1,
  Home: () => 0,
  End: ({ snapshotCount }) => snapshotCount - 1,
}

function snapshotRowId(snapshotId: number): string {
  return `snapshot-row-${snapshotId}`
}

function activeSnapshotRowId(selectedSnapshotId: number | null): string | undefined {
  if (selectedSnapshotId == null) return undefined
  return snapshotRowId(selectedSnapshotId)
}

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

function EmptySnapshotList({ onCreate }: { onCreate: () => void }) {
  return (
    <div className={styles.empty}>
      <ClockCounterClockwiseIcon size={40} className={styles.emptyIcon} />
      <h3 className={styles.emptyTitle}>No snapshots yet.</h3>
      <p className={styles.emptyBody}>
        Snapshots capture your open connections and tabs so you can restore them later.
      </p>
      <Button onClick={onCreate}>
        <CameraPlusIcon size={16} />
        Create your first snapshot
      </Button>
    </div>
  )
}

interface SnapshotRowProps {
  snapshot: SnapshotSummary
  isSelected: boolean
  onSelect: (snapshotId: SnapshotSummary['id']) => void
  onDelete: (snapshot: SnapshotSummary) => void
}

function SnapshotRow({ snapshot, isSelected, onSelect, onDelete }: SnapshotRowProps) {
  const timestamp = formatSnapshotTimestamp(snapshot.createdAt)
  const rowClassName = isSelected ? `${styles.row} ${styles.rowSelected}` : styles.row
  return (
    <div
      id={snapshotRowId(snapshot.id)}
      data-testid={snapshotRowId(snapshot.id)}
      role="option"
      aria-selected={isSelected}
      className={rowClassName}
      onClick={() => onSelect(snapshot.id)}
    >
      <div className={styles.rowHeader}>
        <span className={styles.timestamp}>{timestamp}</span>
        <span className={styles.chip}>{formatSnapshotTrigger(snapshot.triggerType)}</span>
        <Button
          variant="subtle"
          size="sm"
          dangerText
          iconOnly
          className={styles.deleteButton}
          aria-label={`Delete snapshot from ${timestamp}`}
          data-testid={`snapshot-delete-${snapshot.id}`}
          onClick={(event) => {
            event.stopPropagation()
            onDelete(snapshot)
          }}
        >
          <TrashIcon size={16} />
        </Button>
      </div>
      <div className={styles.counts}>
        {formatSnapshotCounts(snapshot.connectionCount, snapshot.tabCount)}
      </div>
      <div className={styles.breakdown}>{formatConnectionBreakdown(snapshot.connections)}</div>
    </div>
  )
}

export function SnapshotDialog() {
  const isDialogOpen = useSnapshotStore((state) => state.isDialogOpen)
  const snapshots = useSnapshotStore((state) => state.snapshots)
  const selectedSnapshotId = useSnapshotStore((state) => state.selectedSnapshotId)
  const isBusy = useSnapshotStore((state) => state.isBusy)
  const isRestoring = useSnapshotStore((state) => state.isRestoring)
  const closeDialog = useSnapshotStore((state) => state.closeDialog)
  const selectSnapshot = useSnapshotStore((state) => state.selectSnapshot)
  const createManualSnapshot = useSnapshotStore((state) => state.createManualSnapshot)
  const restoreSnapshot = useSnapshotStore((state) => state.restoreSnapshot)
  const deleteSnapshot = useSnapshotStore((state) => state.deleteSnapshot)

  const [confirm, setConfirm] = useState<ConfirmState>(null)

  const handleCreateClick = useCallback(() => {
    setConfirm({ kind: 'create' })
  }, [])

  const handleRestoreClick = useCallback(() => {
    if (selectedSnapshotId == null) {
      return
    }
    const snapshot = snapshots.find((summary) => summary.id === selectedSnapshotId)
    if (!snapshot) {
      return
    }
    const unsavedCount = useConnectionStore.getState().connectionsWithUnsavedEdits().length
    setConfirm({ kind: 'restore', snapshot: snapshot, unsavedCount: unsavedCount })
  }, [selectedSnapshotId, snapshots])

  const handleDeleteClick = useCallback((snapshot: SnapshotSummary) => {
    setConfirm({ kind: 'delete', snapshot: snapshot })
  }, [])

  const handleConfirm = useCallback(async () => {
    if (!confirm) {
      return
    }
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

  const handleListKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (snapshots.length === 0) {
        return
      }
      const currentIndex = snapshots.findIndex((summary) => summary.id === selectedSnapshotId)

      const selectAt = (index: number) => {
        const clamped = Math.max(0, Math.min(snapshots.length - 1, index))
        selectSnapshot(snapshots[clamped].id)
      }

      const resolveTargetIndex = SNAPSHOT_LIST_KEY_TARGETS[event.key]
      if (!resolveTargetIndex) {
        return
      }
      event.preventDefault()
      selectAt(resolveTargetIndex({ currentIndex: currentIndex, snapshotCount: snapshots.length }))
    },
    [snapshots, selectedSnapshotId, selectSnapshot]
  )

  if (!isDialogOpen) {
    return null
  }

  const restoreDisabled = selectedSnapshotId == null || isRestoring
  const confirmKind = confirm?.kind

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
      <div className={styles.header}>
        <span className={styles.title}>Session snapshots</span>
        <Button onClick={handleCreateClick} data-testid="snapshot-create-button">
          <CameraPlusIcon size={16} />
          Create snapshot
        </Button>
      </div>

      <div
        className={styles.list}
        role="listbox"
        aria-label="Session snapshots"
        aria-activedescendant={activeSnapshotRowId(selectedSnapshotId)}
        tabIndex={0}
        onKeyDown={handleListKeyDown}
      >
        {snapshots.length === 0 && <EmptySnapshotList onCreate={handleCreateClick} />}
        {snapshots.map((snapshot) => (
          <SnapshotRow
            key={snapshot.id}
            snapshot={snapshot}
            isSelected={snapshot.id === selectedSnapshotId}
            onSelect={selectSnapshot}
            onDelete={handleDeleteClick}
          />
        ))}
      </div>

      <div className={styles.footer}>
        <Button onClick={closeDialog}>Close</Button>
        <Button
          variant="accent"
          disabled={restoreDisabled}
          aria-disabled={restoreDisabled}
          title={restoreDisabled ? 'Select a snapshot to restore' : undefined}
          onClick={handleRestoreClick}
          data-testid="snapshot-restore-button"
        >
          Restore snapshot
        </Button>
      </div>

      <ConfirmDialog
        isOpen={confirmKind === 'create'}
        title="Create snapshot?"
        message="Capture the current session as a snapshot? This saves your open connections and tabs so you can restore them later."
        confirmLabel="Create snapshot"
        isDestructive={false}
        warningText={null}
        isLoading={isBusy}
        onConfirm={() => {
          void handleConfirm()
        }}
        onCancel={() => {
          if (!isBusy) {
            setConfirm(null)
          }
        }}
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
        onConfirm={() => {
          void handleConfirm()
        }}
        onCancel={() => {
          if (isBusy) return
          if (isRestoring) return
          setConfirm(null)
        }}
      />

      <ConfirmDialog
        isOpen={confirmKind === 'delete'}
        title="Delete snapshot?"
        message={<DeleteConfirmMessage confirm={confirm} />}
        confirmLabel="Delete"
        isDestructive
        warningText={null}
        isLoading={isBusy}
        onConfirm={() => {
          void handleConfirm()
        }}
        onCancel={() => {
          if (!isBusy) {
            setConfirm(null)
          }
        }}
      />
    </DialogShell>
  )
}
