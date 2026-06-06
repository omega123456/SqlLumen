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

export function SnapshotDialog() {
  const isDialogOpen = useSnapshotStore((s) => s.isDialogOpen)
  const snapshots = useSnapshotStore((s) => s.snapshots)
  const selectedSnapshotId = useSnapshotStore((s) => s.selectedSnapshotId)
  const isBusy = useSnapshotStore((s) => s.isBusy)
  const isRestoring = useSnapshotStore((s) => s.isRestoring)
  const closeDialog = useSnapshotStore((s) => s.closeDialog)
  const selectSnapshot = useSnapshotStore((s) => s.selectSnapshot)
  const createManualSnapshot = useSnapshotStore((s) => s.createManualSnapshot)
  const restoreSnapshot = useSnapshotStore((s) => s.restoreSnapshot)
  const deleteSnapshot = useSnapshotStore((s) => s.deleteSnapshot)

  const [confirm, setConfirm] = useState<ConfirmState>(null)

  const handleCreateClick = useCallback(() => {
    setConfirm({ kind: 'create' })
  }, [])

  const handleRestoreClick = useCallback(() => {
    if (selectedSnapshotId == null) {
      return
    }
    const snapshot = snapshots.find((s) => s.id === selectedSnapshotId)
    if (!snapshot) {
      return
    }
    const unsavedCount = useConnectionStore.getState().connectionsWithUnsavedEdits().length
    setConfirm({ kind: 'restore', snapshot, unsavedCount })
  }, [selectedSnapshotId, snapshots])

  const handleDeleteClick = useCallback((snapshot: SnapshotSummary) => {
    setConfirm({ kind: 'delete', snapshot })
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
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (snapshots.length === 0) {
        return
      }
      const currentIndex = snapshots.findIndex((s) => s.id === selectedSnapshotId)

      const selectAt = (index: number) => {
        const clamped = Math.max(0, Math.min(snapshots.length - 1, index))
        selectSnapshot(snapshots[clamped].id)
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        selectAt(currentIndex < 0 ? 0 : currentIndex + 1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        selectAt(currentIndex < 0 ? snapshots.length - 1 : currentIndex - 1)
      } else if (e.key === 'Home') {
        e.preventDefault()
        selectAt(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        selectAt(snapshots.length - 1)
      }
    },
    [snapshots, selectedSnapshotId, selectSnapshot]
  )

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
      ariaLabel="Session Snapshots"
    >
      <div className={styles.header}>
        <span className={styles.title}>Session Snapshots</span>
        <Button
          variant="secondary"
          onClick={handleCreateClick}
          data-testid="snapshot-create-button"
        >
          <CameraPlusIcon size={16} />
          Create Snapshot
        </Button>
      </div>

      <div
        className={styles.list}
        role="listbox"
        aria-label="Session snapshots"
        aria-activedescendant={
          selectedSnapshotId != null ? `snapshot-row-${selectedSnapshotId}` : undefined
        }
        tabIndex={0}
        onKeyDown={handleListKeyDown}
      >
        {snapshots.length === 0 ? (
          <div className={styles.empty}>
            <ClockCounterClockwiseIcon size={40} className={styles.emptyIcon} />
            <h3 className={styles.emptyTitle}>No snapshots yet.</h3>
            <p className={styles.emptyBody}>
              Snapshots capture your open connections and tabs so you can restore them later.
            </p>
            <Button variant="secondary" onClick={handleCreateClick}>
              <CameraPlusIcon size={16} />
              Create your first snapshot
            </Button>
          </div>
        ) : (
          snapshots.map((snapshot) => {
            const timestamp = formatSnapshotTimestamp(snapshot.createdAt)
            const isSelected = snapshot.id === selectedSnapshotId
            return (
              <div
                key={snapshot.id}
                id={`snapshot-row-${snapshot.id}`}
                data-testid={`snapshot-row-${snapshot.id}`}
                role="option"
                aria-selected={isSelected}
                className={`${styles.row}${isSelected ? ` ${styles.rowSelected}` : ''}`}
                onClick={() => selectSnapshot(snapshot.id)}
              >
                <div className={styles.rowHeader}>
                  <span className={styles.timestamp}>{timestamp}</span>
                  <span className={styles.chip}>{formatSnapshotTrigger(snapshot.triggerType)}</span>
                  <Button
                    variant="rowDelete"
                    className={styles.deleteButton}
                    aria-label={`Delete snapshot from ${timestamp}`}
                    data-testid={`snapshot-delete-${snapshot.id}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteClick(snapshot)
                    }}
                  >
                    <TrashIcon size={16} />
                  </Button>
                </div>
                <div className={styles.counts}>
                  {formatSnapshotCounts(snapshot.connectionCount, snapshot.tabCount)}
                </div>
                <div className={styles.breakdown}>
                  {formatConnectionBreakdown(snapshot.connections)}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className={styles.footer}>
        <Button variant="secondary" onClick={closeDialog}>
          Close
        </Button>
        <Button
          variant="primary"
          disabled={restoreDisabled}
          aria-disabled={restoreDisabled}
          title={restoreDisabled ? 'Select a snapshot to restore' : undefined}
          onClick={handleRestoreClick}
          data-testid="snapshot-restore-button"
        >
          Restore Snapshot
        </Button>
      </div>

      <ConfirmDialog
        isOpen={confirm?.kind === 'create'}
        title="Create snapshot?"
        message="Capture the current session as a snapshot? This saves your open connections and tabs so you can restore them later."
        confirmLabel="Create Snapshot"
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
        isOpen={confirm?.kind === 'restore'}
        title="Restore this snapshot?"
        message={
          confirm?.kind === 'restore' ? (
            <>
              Replace your current connections and tabs with the state from{' '}
              <strong>{formatSnapshotTimestamp(confirm.snapshot.createdAt)}</strong>?
              {confirm.unsavedCount > 0 && (
                <span className={styles.unsavedWarning}>
                  {confirm.unsavedCount === 1
                    ? '1 connection has unsaved changes that will be lost.'
                    : `${confirm.unsavedCount} connections have unsaved changes that will be lost.`}
                </span>
              )}
            </>
          ) : (
            ''
          )
        }
        confirmLabel="Restore"
        isDestructive
        warningText="Your current session is saved as a snapshot first, then closed."
        isLoading={isBusy || isRestoring}
        nonDismissible={isRestoring}
        onConfirm={() => {
          void handleConfirm()
        }}
        onCancel={() => {
          if (!isBusy && !isRestoring) {
            setConfirm(null)
          }
        }}
      />

      <ConfirmDialog
        isOpen={confirm?.kind === 'delete'}
        title="Delete snapshot?"
        message={
          confirm?.kind === 'delete' ? (
            <>
              Delete the snapshot from{' '}
              <strong>{formatSnapshotTimestamp(confirm.snapshot.createdAt)}</strong>?
            </>
          ) : (
            ''
          )
        }
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
