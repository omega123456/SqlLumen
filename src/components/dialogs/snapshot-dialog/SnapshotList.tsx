import { useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { CameraPlusIcon, ClockCounterClockwiseIcon, TrashIcon } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { useSnapshotStore } from '../../../stores/snapshot-store'
import {
  formatConnectionBreakdown,
  formatSnapshotCounts,
  formatSnapshotTimestamp,
  formatSnapshotTrigger,
} from '../../../lib/snapshot-format'
import type { SnapshotSummary } from '../../../lib/session-snapshot-commands'
import styles from '../SnapshotDialog.module.css'

const EMPTY_ICON_SIZE = 40
const BUTTON_ICON_SIZE = 16

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

function EmptySnapshotList({ onCreate }: { onCreate: () => void }) {
  return (
    <div className={styles.empty}>
      <ClockCounterClockwiseIcon size={EMPTY_ICON_SIZE} className={styles.emptyIcon} />
      <h3 className={styles.emptyTitle}>No snapshots yet.</h3>
      <p className={styles.emptyBody}>
        Snapshots capture your open connections and tabs so you can restore them later.
      </p>
      <Button onClick={onCreate}>
        <CameraPlusIcon size={BUTTON_ICON_SIZE} />
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
          <TrashIcon size={BUTTON_ICON_SIZE} />
        </Button>
      </div>
      <div className={styles.counts}>
        {formatSnapshotCounts(snapshot.connectionCount, snapshot.tabCount)}
      </div>
      <div className={styles.breakdown}>{formatConnectionBreakdown(snapshot.connections)}</div>
    </div>
  )
}

function useSnapshotListKeyDown() {
  const snapshots = useSnapshotStore((state) => state.snapshots)
  const selectedSnapshotId = useSnapshotStore((state) => state.selectedSnapshotId)
  const selectSnapshot = useSnapshotStore((state) => state.selectSnapshot)

  return useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (snapshots.length === 0) {
        return
      }
      const resolveTargetIndex = SNAPSHOT_LIST_KEY_TARGETS[event.key]
      if (!resolveTargetIndex) {
        return
      }
      event.preventDefault()
      const currentIndex = snapshots.findIndex((summary) => summary.id === selectedSnapshotId)
      const targetIndex = resolveTargetIndex({
        currentIndex: currentIndex,
        snapshotCount: snapshots.length,
      })
      const clamped = Math.max(0, Math.min(snapshots.length - 1, targetIndex))
      selectSnapshot(snapshots[clamped].id)
    },
    [snapshots, selectedSnapshotId, selectSnapshot]
  )
}

interface SnapshotListProps {
  onCreate: () => void
  onDelete: (snapshot: SnapshotSummary) => void
}

export function SnapshotList({ onCreate, onDelete }: SnapshotListProps) {
  const snapshots = useSnapshotStore((state) => state.snapshots)
  const selectedSnapshotId = useSnapshotStore((state) => state.selectedSnapshotId)
  const selectSnapshot = useSnapshotStore((state) => state.selectSnapshot)
  const handleListKeyDown = useSnapshotListKeyDown()

  return (
    <div
      className={styles.list}
      role="listbox"
      aria-label="Session snapshots"
      aria-activedescendant={activeSnapshotRowId(selectedSnapshotId)}
      tabIndex={0}
      onKeyDown={handleListKeyDown}
    >
      {snapshots.length === 0 && <EmptySnapshotList onCreate={onCreate} />}
      {snapshots.map((snapshot) => (
        <SnapshotRow
          key={snapshot.id}
          snapshot={snapshot}
          isSelected={snapshot.id === selectedSnapshotId}
          onSelect={selectSnapshot}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}
