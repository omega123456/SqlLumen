import { useState, useCallback } from 'react'
import { Checkbox } from '../common/Checkbox'
import { DialogShell } from './DialogShell'
import { Button } from '../common/Button'
import { InfoBar } from '../common/InfoBar'
import {
  startSqlImport,
  getImportProgress,
  cancelImport,
  type ImportJobProgress,
} from '../../lib/sql-dump-commands'
import { showSuccessToast, showErrorToast, showWarningToast } from '../../stores/toast-store'
import styles from './SqlImportDialog.module.css'

import { logFrontendError } from '../../lib/app-log-commands'
import { isPlaywrightBuild } from '../../lib/tauri-env'
import { isTerminalJobStatus, progressPercent } from '../../lib/job-progress'
import { useJobProgressPolling } from '../../hooks/useJobProgressPolling'

function pluralSuffix(count: number): string {
  return count > 1 ? 's' : ''
}

function announceImportOutcome(progress: ImportJobProgress): void {
  if (progress.status === 'failed') {
    showErrorToast(
      'Import failed',
      progress.errors[0]?.errorMessage ?? 'Import stopped due to error'
    )
    return
  }
  if (progress.status === 'cancelled') {
    showWarningToast(
      'Import cancelled',
      `${progress.statementsDone} statements were executed before cancellation`
    )
    return
  }
  const hasNoErrors = progress.errors.length === 0
  if (hasNoErrors) {
    showSuccessToast(
      'Import completed',
      `${progress.statementsDone} statements executed successfully`
    )
    return
  }
  showWarningToast(
    'Import completed with errors',
    `${progress.errors.length} error${pluralSuffix(progress.errors.length)} — ${progress.statementsDone} statements processed`
  )
}

const PATH_SEPARATOR_PATTERN = /[\\/]/

function fileNameFromPath(filePath: string): string {
  return filePath.split(PATH_SEPARATOR_PATTERN).pop() ?? filePath
}

function isCleanCompletion(progress: ImportJobProgress): boolean {
  return progress.status === 'completed' && progress.errors.length === 0
}

function ImportOutcomeText({ progress }: { progress: ImportJobProgress }) {
  if (isCleanCompletion(progress)) {
    return <>Import completed successfully ({progress.statementsDone} statements executed)</>
  }
  if (progress.status === 'completed') {
    return (
      <>
        Import completed with {progress.errors.length} error
        {pluralSuffix(progress.errors.length)}
      </>
    )
  }
  if (progress.status === 'failed') {
    return <>Import stopped due to error (stop-on-error enabled)</>
  }
  if (progress.status === 'cancelled') {
    return <>Import was cancelled</>
  }
  return null
}

function ImportStatusMessage({ progress }: { progress: ImportJobProgress }) {
  const successClassName = isCleanCompletion(progress) ? styles.statusSuccess : ''
  return (
    <div className={`${styles.statusMessage} ${successClassName}`} data-testid="import-status">
      <ImportOutcomeText progress={progress} />
    </div>
  )
}

function ImportProgressPanel({ progress }: { progress: ImportJobProgress }) {
  const statementsPercent = progressPercent(progress.statementsDone, progress.statementsTotal)
  return (
    <div className={styles.progressSection} data-testid="import-progress">
      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${statementsPercent}%` }} />
      </div>
      <span className={styles.progressText}>
        {progress.statementsDone} / {progress.statementsTotal} statements — {statementsPercent}%
      </span>
    </div>
  )
}

function ImportErrorList({ errors }: { errors: ImportJobProgress['errors'] }) {
  if (errors.length === 0) return null
  return (
    <div className={styles.errorList} data-testid="import-error-list">
      {errors.map((error, index) => (
        <div key={index} className={styles.errorItem} data-testid={`import-error-${index}`}>
          <strong>Statement #{error.statementIndex + 1}:</strong> {error.errorMessage}
          {error.sqlPreview && <span className={styles.errorSql}>{error.sqlPreview}</span>}
        </div>
      ))}
    </div>
  )
}

interface ImportActionsProps {
  isImporting: boolean
  isTerminal: boolean
  onImport: () => void
  onCancelImport: () => void
  onClose: () => void
}

function ImportActions({
  isImporting,
  isTerminal,
  onImport,
  onCancelImport,
  onClose,
}: ImportActionsProps) {
  const cancelImportButton = (
    <Button type="button" onClick={onCancelImport} data-testid="import-cancel-button">
      Cancel import
    </Button>
  )
  if (isTerminal) {
    return (
      <div className={styles.actions}>
        {isImporting && cancelImportButton}
        <Button type="button" onClick={onClose} data-testid="import-done-button">
          Close
        </Button>
      </div>
    )
  }
  return (
    <div className={styles.actions}>
      <Button
        type="button"
        variant="accent"
        onClick={onImport}
        disabled={isImporting}
        data-testid="import-submit-button"
      >
        {isImporting ? 'Importing...' : 'Import'}
      </Button>
      {isImporting && cancelImportButton}
      {!isImporting && (
        <Button type="button" onClick={onClose} data-testid="import-dismiss-button">
          Cancel
        </Button>
      )}
    </div>
  )
}

export interface SqlImportDialogProps {
  connectionId: string
  filePath: string
  onClose: () => void
}

export default function SqlImportDialog({ connectionId, filePath, onClose }: SqlImportDialogProps) {
  // Options
  const [stopOnError, setStopOnError] = useState(true)

  // Import state
  const [isImporting, setIsImporting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<ImportJobProgress | null>(null)

  const isTerminal = isTerminalJobStatus(progress?.status)

  const handleImportFinished = (finishedProgress: ImportJobProgress) => {
    setIsImporting(false)
    announceImportOutcome(finishedProgress)
  }

  useJobProgressPolling({
    jobId: jobId,
    fetchProgress: getImportProgress,
    onProgress: setProgress,
    onFinished: handleImportFinished,
    pollFailureMessage: '[sql-import] Failed to poll progress:',
  })

  // Handle import start
  const handleImport = useCallback(async () => {
    if (!filePath) return
    setIsImporting(true)
    setProgress(null)

    try {
      const id = await startSqlImport(connectionId, filePath, stopOnError)
      setJobId(id)
    } catch (error) {
      setIsImporting(false)
      logFrontendError('[sql-import] Failed to start import:', error)
    }
  }, [connectionId, filePath, stopOnError])

  // Handle cancel
  const handleCancel = useCallback(async () => {
    if (!jobId) return
    try {
      await cancelImport(jobId)
    } catch (error) {
      logFrontendError('[sql-import] Failed to cancel import:', error)
    }
  }, [jobId])

  const fileName = fileNameFromPath(filePath)

  return (
    <DialogShell
      isOpen={true}
      onClose={onClose}
      maxWidth={520}
      testId="sql-import-dialog"
      ariaLabel="Import SQL script"
      disableFocusManagement={isPlaywrightBuild()}
      nonDismissible={isImporting}
    >
      <div className={styles.root}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Import SQL script</h2>
          <Button
            variant="bare"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
            disabled={isImporting}
            data-testid="import-close-button"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </Button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {/* File path */}
          <div className={styles.fieldGroup}>
            <span className={styles.label}>File</span>
            <div className={styles.filePath} data-testid="import-file-path">
              {fileName}
            </div>
          </div>

          {/* Options */}
          <div className={styles.fieldGroup}>
            <span className={styles.label}>Options</span>
            <div className={styles.checkboxRow}>
              <Checkbox
                id="import-stop-on-error"
                checked={stopOnError}
                onChange={(event) => setStopOnError(event.target.checked)}
                disabled={isImporting || isTerminal}
                data-testid="import-stop-on-error"
              />
              <label htmlFor="import-stop-on-error" className={styles.checkboxLabel}>
                Stop on first error
              </label>
            </div>
          </div>

          {progress && <ImportProgressPanel progress={progress} />}

          {isTerminal && progress && <ImportStatusMessage progress={progress} />}

          {progress && <ImportErrorList errors={progress.errors} />}

          <InfoBar
            severity="info"
            message={
              <>
                Statements are executed sequentially. Large scripts may take several minutes. The
                import runs in the background.
              </>
            }
            data-testid="import-footer-text"
          />

          <ImportActions
            isImporting={isImporting}
            isTerminal={isTerminal}
            onImport={handleImport}
            onCancelImport={handleCancel}
            onClose={onClose}
          />
        </div>
      </div>
    </DialogShell>
  )
}
