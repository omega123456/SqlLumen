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
import { joinClassNames, SCROLLBAR } from '../../../lib/class-names'
import { FOCUS_RING } from '../../../lib/focus-ring'

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

type SnapshotRowState = 'idle' | 'selected'

const SNAPSHOT_ROW_STATE_CLASSES: Record<SnapshotRowState, string> = {
  idle: 'border-l-transparent hover:bg-light-fill-subtle-hover dark:hover:bg-dark-fill-subtle-hover',
  selected:
    'border-l-light-primary bg-light-fill-subtle-hover shadow-light-row-selected dark:border-l-dark-primary dark:bg-dark-fill-subtle-hover dark:shadow-dark-row-selected',
}

function snapshotRowClassName(isSelected: boolean): string {
  const state: SnapshotRowState = isSelected ? 'selected' : 'idle'
  return joinClassNames([
    'flex cursor-pointer flex-col gap-1 rounded-card border-l-4 px-3 py-2 transition-bg-border-shadow duration-120',
    'group',
    SNAPSHOT_ROW_STATE_CLASSES[state],
  ])
}

function EmptySnapshotList({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <ClockCounterClockwiseIcon
        size={EMPTY_ICON_SIZE}
        className="text-light-on-surface-variant dark:text-dark-on-surface-variant"
      />
      <h3 className="text-size-body font-semibold text-light-on-surface dark:text-dark-on-surface wrap-break-word">
        No snapshots yet.
      </h3>
      <p className="max-w-90 text-size-body text-light-on-surface-variant dark:text-dark-on-surface-variant wrap-break-word">
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
  return (
    <div
      id={snapshotRowId(snapshot.id)}
      data-testid={snapshotRowId(snapshot.id)}
      role="option"
      aria-selected={isSelected}
      className={snapshotRowClassName(isSelected)}
      onClick={() => onSelect(snapshot.id)}
    >
      <div className="flex items-center gap-2">
        <span className="text-size-body font-semibold text-light-on-surface dark:text-dark-on-surface">
          {timestamp}
        </span>
        <span className="inline-flex items-center rounded-card border border-light-stroke-card bg-light-fill-neutral-selected px-1.5 py-0.5 text-size-caption font-semibold text-light-on-surface-variant dark:border-dark-stroke-card dark:bg-dark-fill-neutral-selected dark:text-dark-on-surface-variant">
          {formatSnapshotTrigger(snapshot.triggerType)}
        </span>
        <Button
          variant="bare"
          className={joinClassNames([
            'ml-auto inline-flex size-7 cursor-pointer items-center justify-center gap-1.5 rounded-card bg-transparent p-1 text-size-row whitespace-nowrap text-light-on-surface opacity-0 transition-opacity-and-color duration-120 not-disabled:hover:bg-light-fill-subtle-hover not-disabled:active:bg-light-fill-subtle-pressed hover:text-light-error group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed dark:text-dark-on-surface dark:not-disabled:hover:bg-dark-fill-subtle-hover dark:not-disabled:active:bg-dark-fill-subtle-pressed dark:hover:text-dark-error',
            FOCUS_RING,
          ])}
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
      <div className="text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
        {formatSnapshotCounts(snapshot.connectionCount, snapshot.tabCount)}
      </div>
      <div className="text-size-caption wrap-anywhere text-light-on-surface-variant dark:text-dark-on-surface-variant">
        {formatConnectionBreakdown(snapshot.connections)}
      </div>
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
      className={joinClassNames([
        'flex flex-1 flex-col gap-1 overflow-y-auto p-2',
        SCROLLBAR,
        FOCUS_RING,
      ])}
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
