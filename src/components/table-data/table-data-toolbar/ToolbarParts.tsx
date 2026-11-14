import { Plus, Copy, Trash, FloppyDisk, ArrowCounterClockwise, Stop } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import type {
  DeleteCopy,
  RowActionAvailability,
  RowActionHandlers,
  ToolbarTabView,
} from './toolbar-model'
import styles from '../TableDataToolbar.module.css'

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
        <span className={styles.viewBadge} data-testid="view-badge">
          VIEW
        </span>
      )}

      {isConnectionReadOnly && (
        <span className={styles.readonlyBadge} data-testid="readonly-badge">
          &#x1F512; READ-ONLY
        </span>
      )}

      {showNoKeyBadge && (
        <span className={styles.nopkBadge} data-testid="nopk-badge">
          NO KEY
        </span>
      )}
    </>
  )
}

interface RowActionButtonsProps {
  availability: RowActionAvailability
  deleteCopy: DeleteCopy
  handlers: RowActionHandlers
}

export function RowActionButtons({ availability, deleteCopy, handlers }: RowActionButtonsProps) {
  return (
    <>
      <Button
        variant="bare"
        className={styles.toolbarButton}
        disabled={!availability.canAdd}
        onClick={handlers.onAdd}
        title="Add row"
        data-testid="btn-add-row"
      >
        <Plus size={16} weight="bold" />
        <span>Add</span>
      </Button>

      <Button
        variant="bare"
        className={styles.toolbarButton}
        disabled={!availability.canClone}
        onClick={handlers.onClone}
        title="Clone selected row; primary key fields are left blank."
        data-testid="btn-clone-row"
      >
        <Copy size={16} weight="regular" />
        <span>Clone</span>
      </Button>

      <Button
        variant="bare"
        className={styles.toolbarButton}
        disabled={!availability.canDelete}
        onClick={handlers.onDelete}
        title={deleteCopy.buttonTitle}
        data-testid="btn-delete-row"
      >
        <Trash size={16} weight="regular" />
        <span>{deleteCopy.buttonLabel}</span>
      </Button>

      <Button
        variant="bare"
        className={styles.toolbarButton}
        disabled={!availability.canSaveOrDiscard}
        onClick={handlers.onSave}
        title="Save changes"
        data-testid="btn-save"
      >
        <FloppyDisk size={16} weight="regular" />
        <span>Save</span>
      </Button>

      <Button
        variant="bare"
        className={styles.toolbarButton}
        disabled={!availability.canSaveOrDiscard}
        onClick={handlers.onDiscard}
        title="Discard changes"
        data-testid="btn-discard"
      >
        <span>Discard</span>
      </Button>
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
    const cancellingClassName = view.isCancelling ? ` ${styles.cancelling}` : ''
    return (
      <Button
        variant="bare"
        className={`${styles.cancelButton}${cancellingClassName}`}
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
      variant="bare"
      className={styles.iconButton}
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
    <span className={styles.statusHint} data-testid="table-data-restoring-status">
      Restoring cached rows...
    </span>
  )
}
