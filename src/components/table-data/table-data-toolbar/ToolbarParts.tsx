import type { ReactNode } from 'react'
import { Plus, Copy, Trash, FloppyDisk, ArrowCounterClockwise, Stop } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import type {
  DeleteCopy,
  RowActionAvailability,
  RowActionHandlers,
  ToolbarTabView,
} from './toolbar-model'
import { joinClassNames } from '../../../lib/class-names'

export function ToolbarDivider() {
  return (
    <div className="mx-1 h-5 w-px shrink-0 bg-light-stroke-divider dark:bg-dark-stroke-divider" />
  )
}

type ToolbarBadgeKind = 'view' | 'readOnly' | 'noKey'

const BADGE_KIND_CLASSES: Record<ToolbarBadgeKind, string> = {
  view: 'select-none border border-light-primary-a30 bg-light-fill-accent-tint text-light-primary dark:border-dark-primary-a30 dark:bg-dark-fill-accent-tint dark:text-dark-primary',
  readOnly:
    'bg-light-fill-neutral-selected text-light-on-surface-variant dark:bg-dark-fill-neutral-selected dark:text-dark-on-surface-variant',
  noKey:
    'bg-light-warning-container text-light-warning dark:bg-dark-warning-container dark:text-dark-warning',
}

interface ToolbarBadgeProps {
  kind: ToolbarBadgeKind
  testId: string
  children: ReactNode
}

function ToolbarBadge({ kind, testId, children }: ToolbarBadgeProps) {
  return (
    <span
      className={joinClassNames([
        'flex h-5 shrink-0 items-center gap-0.75 rounded-control px-1.5 font-mono text-size-caption font-semibold whitespace-nowrap',
        BADGE_KIND_CLASSES[kind],
      ])}
      data-testid={testId}
    >
      {children}
    </span>
  )
}

interface ToolbarBadgesProps {
  isView: boolean
  isConnectionReadOnly: boolean
  showNoKeyBadge: boolean
}

export function ToolbarBadges({
  isView,
  isConnectionReadOnly,
  showNoKeyBadge,
}: ToolbarBadgesProps) {
  return (
    <>
      {isView && (
        <ToolbarBadge kind="view" testId="view-badge">
          VIEW
        </ToolbarBadge>
      )}

      {isConnectionReadOnly && (
        <ToolbarBadge kind="readOnly" testId="readonly-badge">
          &#x1F512; READ-ONLY
        </ToolbarBadge>
      )}

      {showNoKeyBadge && (
        <ToolbarBadge kind="noKey" testId="nopk-badge">
          NO KEY
        </ToolbarBadge>
      )}
    </>
  )
}

interface RowActionButtonsProps {
  availability: RowActionAvailability
  deleteCopy: DeleteCopy
  handlers: RowActionHandlers
}

interface RowActionButtonProps {
  testId: string
  title: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}

function RowActionButton({ testId, title, disabled, onClick, children }: RowActionButtonProps) {
  return (
    <Button
      variant="subtle"
      size="toolbar"
      className="shrink-0"
      disabled={disabled}
      onClick={onClick}
      title={title}
      data-testid={testId}
    >
      {children}
    </Button>
  )
}

export function RowActionButtons({ availability, deleteCopy, handlers }: RowActionButtonsProps) {
  return (
    <>
      <RowActionButton
        testId="btn-add-row"
        title="Add row"
        disabled={!availability.canAdd}
        onClick={handlers.onAdd}
      >
        <Plus size={16} weight="bold" />
        <span>Add</span>
      </RowActionButton>

      <RowActionButton
        testId="btn-clone-row"
        title="Clone selected row; primary key fields are left blank."
        disabled={!availability.canClone}
        onClick={handlers.onClone}
      >
        <Copy size={16} weight="regular" />
        <span>Clone</span>
      </RowActionButton>

      <RowActionButton
        testId="btn-delete-row"
        title={deleteCopy.buttonTitle}
        disabled={!availability.canDelete}
        onClick={handlers.onDelete}
      >
        <Trash size={16} weight="regular" />
        <span>{deleteCopy.buttonLabel}</span>
      </RowActionButton>

      <RowActionButton
        testId="btn-save"
        title="Save changes"
        disabled={!availability.canSaveOrDiscard}
        onClick={handlers.onSave}
      >
        <FloppyDisk size={16} weight="regular" />
        <span>Save</span>
      </RowActionButton>

      <RowActionButton
        testId="btn-discard"
        title="Discard changes"
        disabled={!availability.canSaveOrDiscard}
        onClick={handlers.onDiscard}
      >
        <span>Discard</span>
      </RowActionButton>
    </>
  )
}

interface LoadControlButtonProps {
  view: Pick<ToolbarTabView, 'isLoading' | 'isRestoring' | 'isCancelling'>
  isBusy: boolean
  onCancelLoad: () => void
  onRefresh: () => void
}

export function LoadControlButton({
  view,
  isBusy,
  onCancelLoad,
  onRefresh,
}: LoadControlButtonProps) {
  const isCancellableLoad = view.isLoading && !view.isRestoring
  if (isCancellableLoad) {
    return (
      <Button
        variant="subtle"
        size="toolbar"
        className="shrink-0 disabled:opacity-60"
        onClick={onCancelLoad}
        disabled={view.isCancelling}
        title="Cancel the running query"
        data-testid="btn-cancel-load"
      >
        <Stop size={14} weight="fill" />
        <span>{view.isCancelling ? 'Cancelling...' : 'Cancel'}</span>
      </Button>
    )
  }
  return (
    <Button
      variant="subtle"
      size="toolbar"
      iconOnly
      className="shrink-0"
      onClick={onRefresh}
      disabled={isBusy}
      title="Refresh data"
      data-testid="btn-refresh"
    >
      <ArrowCounterClockwise size={16} weight="bold" />
    </Button>
  )
}

export function RestoringStatusHint({ isRestoring }: { isRestoring: boolean }) {
  if (!isRestoring) return undefined
  return (
    <span
      className="text-size-caption whitespace-nowrap text-light-on-surface-variant dark:text-dark-on-surface-variant"
      data-testid="table-data-restoring-status"
    >
      Restoring cached rows...
    </span>
  )
}
