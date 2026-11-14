import { Button } from '../../common/Button'
import type { CopyProgress } from '../../../lib/copy-to-host-commands'
import { progressPercent } from '../../../lib/job-progress'
import { objectCountText } from './copy-to-host-model'
import styles from '../CopyToHostDialog.module.css'

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
      <span className={styles.progressCount} data-testid="copy-row-count">
        {(progress.rowsDone ?? 0).toLocaleString()} / {(progress.rowsTotal ?? 0).toLocaleString()}
      </span>
    )
  }
  if (isRunningObjectWithType(progress)) {
    return (
      <span className={styles.typeBadge} data-testid="copy-type-badge">
        {progress.currentObjectType}
      </span>
    )
  }
  return null
}

function CopyOutcomeStatus({ progress }: { progress: CopyProgress }) {
  if (progress.status === 'completed') {
    return (
      <p className={styles.statusSuccess} data-testid="copy-status-success">
        Completed — {objectCountText(progress.objectsDone)} copied
      </p>
    )
  }
  if (progress.status === 'cancelled') {
    return (
      <p className={styles.statusCancel} data-testid="copy-status-cancel">
        Cancelled — {progress.objectsDone} of {progress.objectsTotal} objects copied
      </p>
    )
  }
  if (progress.status !== 'failed') return null
  const failedObjectSuffix = progress.currentObject ? ` on ${progress.currentObject}` : ''
  return (
    <div className={styles.statusError} data-testid="copy-status-error">
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
    <div className={styles.progressSection} data-testid="copy-progress">
      <div className={styles.progressRow}>
        <span className={styles.progressLabel}>Objects</span>
        <div className={styles.macroBar}>
          <div className={styles.macroFill} style={{ width: `${objectsPercent}%` }} />
        </div>
        <span className={styles.progressCount}>
          {progress.objectsDone} / {progress.objectsTotal}
        </span>
      </div>

      {progress.currentObject && (
        <div className={styles.progressRow}>
          <span className={styles.currentObjectName}>{progress.currentObject}</span>
          <CurrentObjectDetail progress={progress} />
        </div>
      )}

      {isRunningTableWithKnownRows(progress) && (
        <div className={styles.microBar}>
          <div className={styles.microFill} style={{ width: `${rowsPercent}%` }} />
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
      <div className={styles.footerActions}>
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
    <div className={styles.footerActions}>
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
