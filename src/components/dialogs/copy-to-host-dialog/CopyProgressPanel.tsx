import { Button } from '../../common/Button'
import type { CopyProgress } from '../../../lib/copy-to-host-commands'
import { progressPercent } from '../../../lib/job-progress'
import { objectCountText } from './copy-to-host-model'
import { joinClassNames } from '../../../lib/class-names'
import {
  DIALOG_PROGRESS_COUNT,
  DIALOG_PROGRESS_LABEL,
  DIALOG_PROGRESS_TRACK,
} from '../../../lib/class-names-dialog'

function isRunningTableWithKnownRows(progress: CopyProgress): boolean {
  if (progress.status !== 'running') return false
  return progress.currentObjectType === 'table' && Boolean(progress.rowsTotal)
}

function isRunningObjectWithType(progress: CopyProgress): boolean {
  if (progress.status !== 'running') return false
  return Boolean(progress.currentObject) && Boolean(progress.currentObjectType)
}

function CurrentObjectDetail({ progress }: { progress: CopyProgress }) {
  if (isRunningTableWithKnownRows(progress)) {
    return (
      <span
        className={joinClassNames([DIALOG_PROGRESS_COUNT, 'text-right tabular-nums'])}
        data-testid="copy-row-count"
      >
        {(progress.rowsDone ?? 0).toLocaleString()} / {(progress.rowsTotal ?? 0).toLocaleString()}
      </span>
    )
  }
  if (isRunningObjectWithType(progress)) {
    return (
      <span
        className="font-body text-size-caption font-semibold whitespace-nowrap text-light-tertiary dark:text-dark-tertiary"
        data-testid="copy-type-badge"
      >
        {progress.currentObjectType}
      </span>
    )
  }
  return null
}

function CopyOutcomeStatus({ progress }: { progress: CopyProgress }) {
  if (progress.status === 'completed') {
    return (
      <p
        className="font-body text-size-caption text-light-tertiary dark:text-dark-tertiary wrap-break-word"
        data-testid="copy-status-success"
      >
        Completed — {objectCountText(progress.objectsDone)} copied
      </p>
    )
  }
  if (progress.status === 'cancelled') {
    return (
      <p
        className="font-body text-size-caption text-light-warning dark:text-dark-warning wrap-break-word"
        data-testid="copy-status-cancel"
      >
        Cancelled — {progress.objectsDone} of {progress.objectsTotal} objects copied
      </p>
    )
  }
  if (progress.status !== 'failed') return null
  const failedObjectSuffix = progress.currentObject ? ` on ${progress.currentObject}` : ''
  return (
    <div
      className="rounded-card border border-light-error-a20 bg-light-error-container px-3 py-2 font-body text-size-caption leading-compact text-light-error dark:border-dark-error-a20 dark:bg-dark-error-container dark:text-dark-error"
      data-testid="copy-status-error"
    >
      Failed
      {failedObjectSuffix}:
      <br />
      {progress.errorMessage ?? 'Unknown error'}
    </div>
  )
}

export function CopyProgressPanel({ progress }: { progress: CopyProgress }) {
  const objectsPercent = progressPercent(progress.objectsDone, progress.objectsTotal)
  const rowsPercent = progressPercent(progress.rowsDone, progress.rowsTotal)
  return (
    <div
      className="flex shrink-0 flex-col gap-2 border-t border-light-stroke-divider bg-light-fill-control px-6 py-3.5 dark:border-dark-stroke-divider dark:bg-dark-fill-control"
      data-testid="copy-progress"
    >
      <div className="flex items-center gap-2.5">
        <span className={joinClassNames([DIALOG_PROGRESS_LABEL, 'min-w-14'])}>Objects</span>
        <div className={joinClassNames([DIALOG_PROGRESS_TRACK, 'flex-1'])}>
          <div
            className="h-full rounded-track bg-light-primary transition-width duration-300 dark:bg-dark-primary"
            style={{ width: `${objectsPercent}%` }}
          />
        </div>
        <span className={joinClassNames([DIALOG_PROGRESS_COUNT, 'text-right tabular-nums'])}>
          {progress.objectsDone} / {progress.objectsTotal}
        </span>
      </div>

      {progress.currentObject && (
        <div className="flex items-center gap-2.5">
          <span className="min-w-0 flex-1 truncate font-mono text-size-caption text-light-on-surface dark:text-dark-on-surface">
            {progress.currentObject}
          </span>
          <CurrentObjectDetail progress={progress} />
        </div>
      )}

      {isRunningTableWithKnownRows(progress) && (
        <div className="h-0.75 w-full overflow-hidden rounded-track bg-light-fill-neutral-selected dark:bg-dark-fill-neutral-selected">
          <div
            className="h-full rounded-track bg-light-tertiary transition-width duration-300 dark:bg-dark-tertiary"
            style={{ width: `${rowsPercent}%` }}
          />
        </div>
      )}

      <CopyOutcomeStatus progress={progress} />
    </div>
  )
}

interface CopyFooterHandlers {
  onClose: () => void
  onCancel: () => void
  onCopy: () => void
}

interface CopyFooterActionsProps {
  showProgress: boolean
  isTerminal: boolean
  isCancelling: boolean
  canCopy: boolean
  handlers: CopyFooterHandlers
}

function progressActionLabel(isTerminal: boolean, isCancelling: boolean): string {
  if (isTerminal) return 'Close'
  if (isCancelling) return 'Cancelling…'
  return 'Cancel'
}

export function CopyFooterActions({
  showProgress,
  isTerminal,
  isCancelling,
  canCopy,
  handlers,
}: CopyFooterActionsProps) {
  if (showProgress) {
    return (
      <div className="flex shrink-0 justify-end gap-3 border-t border-light-stroke-divider px-6 py-4 dark:border-dark-stroke-divider">
        <Button
          variant={isTerminal ? 'default' : 'danger'}
          onClick={isTerminal ? handlers.onClose : handlers.onCancel}
          disabled={!isTerminal && isCancelling}
          data-testid="copy-progress-action"
        >
          {progressActionLabel(isTerminal, isCancelling)}
        </Button>
      </div>
    )
  }
  return (
    <div className="flex shrink-0 justify-end gap-3 border-t border-light-stroke-divider px-6 py-4 dark:border-dark-stroke-divider">
      <Button
        variant="accent"
        onClick={handlers.onCopy}
        disabled={!canCopy}
        data-testid="copy-submit-button"
      >
        Copy
      </Button>
      <Button onClick={handlers.onClose} data-testid="copy-cancel-button">
        Cancel
      </Button>
    </div>
  )
}
