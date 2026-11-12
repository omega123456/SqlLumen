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
  if (progress.errors.length === 0) {
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

  const statementsPercent = progressPercent(progress?.statementsDone, progress?.statementsTotal)

  // File name from path
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath

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

          {/* Progress */}
          {progress && (
            <div className={styles.progressSection} data-testid="import-progress">
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${statementsPercent}%` }} />
              </div>
              <span className={styles.progressText}>
                {progress.statementsDone} / {progress.statementsTotal} statements —{' '}
                {statementsPercent}%
              </span>
            </div>
          )}

          {/* Status message */}
          {isTerminal && progress && (
            <div
              className={`${styles.statusMessage} ${
                progress.status === 'completed' && progress.errors.length === 0
                  ? styles.statusSuccess
                  : ''
              }`}
              data-testid="import-status"
            >
              {progress.status === 'completed' && progress.errors.length === 0 && (
                <>Import completed successfully ({progress.statementsDone} statements executed)</>
              )}
              {progress.status === 'completed' && progress.errors.length > 0 && (
                <>
                  Import completed with {progress.errors.length} error
                  {pluralSuffix(progress.errors.length)}
                </>
              )}
              {progress.status === 'failed' && (
                <>Import stopped due to error (stop-on-error enabled)</>
              )}
              {progress.status === 'cancelled' && <>Import was cancelled</>}
            </div>
          )}

          {/* Error list */}
          {progress && progress.errors.length > 0 && (
            <div className={styles.errorList} data-testid="import-error-list">
              {progress.errors.map((error, index) => (
                <div key={index} className={styles.errorItem} data-testid={`import-error-${index}`}>
                  <strong>Statement #{error.statementIndex + 1}:</strong> {error.errorMessage}
                  {error.sqlPreview && <span className={styles.errorSql}>{error.sqlPreview}</span>}
                </div>
              ))}
            </div>
          )}

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

          {/* Buttons */}
          <div className={styles.actions}>
            {!isTerminal && (
              <Button
                type="button"
                variant="accent"
                onClick={handleImport}
                disabled={isImporting}
                data-testid="import-submit-button"
              >
                {isImporting ? 'Importing...' : 'Import'}
              </Button>
            )}
            {isImporting && (
              <Button type="button" onClick={handleCancel} data-testid="import-cancel-button">
                Cancel import
              </Button>
            )}
            {isTerminal && (
              <Button type="button" onClick={onClose} data-testid="import-done-button">
                Close
              </Button>
            )}
            {!isImporting && !isTerminal && (
              <Button type="button" onClick={onClose} data-testid="import-dismiss-button">
                Cancel
              </Button>
            )}
          </div>
        </div>
      </div>
    </DialogShell>
  )
}
