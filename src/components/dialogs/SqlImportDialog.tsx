import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Checkbox } from '../common/Checkbox'
import { DialogShell } from './DialogShell'
import {
  startSqlImport,
  getImportProgress,
  cancelImport,
  type ImportJobProgress,
} from '../../lib/sql-dump-commands'
import { showSuccessToast, showErrorToast, showWarningToast } from '../../stores/toast-store'
import styles from './SqlImportDialog.module.css'

const isPlaywright = import.meta.env.VITE_PLAYWRIGHT === 'true'

/** Polling interval for progress updates (ms). */
const PROGRESS_POLL_MS = 500

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

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Derived state
  const isTerminal =
    progress?.status === 'completed' ||
    progress?.status === 'failed' ||
    progress?.status === 'cancelled'

  // Poll for progress when we have a job ID
  useEffect(() => {
    if (!jobId) return

    const poll = () => {
      getImportProgress(jobId)
        .then((p) => {
          setProgress(p)
          if (p.status === 'completed' || p.status === 'failed' || p.status === 'cancelled') {
            setIsImporting(false)
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null

            if (p.status === 'completed') {
              if (p.errors.length === 0) {
                showSuccessToast(
                  'Import completed',
                  `${p.statementsDone} statements executed successfully`
                )
              } else {
                showWarningToast(
                  'Import completed with errors',
                  `${p.errors.length} error${p.errors.length > 1 ? 's' : ''} — ${p.statementsDone} statements processed`
                )
              }
            } else if (p.status === 'failed') {
              showErrorToast(
                'Import failed',
                p.errors[0]?.errorMessage ?? 'Import stopped due to error'
              )
            } else if (p.status === 'cancelled') {
              showWarningToast(
                'Import cancelled',
                `${p.statementsDone} statements were executed before cancellation`
              )
            }
          }
        })
        .catch((err) => {
          console.error('[sql-import] Failed to poll progress:', err)
        })
    }

    pollRef.current = setInterval(poll, PROGRESS_POLL_MS)
    // Also poll immediately
    poll()

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [jobId])

  // Handle import start
  const handleImport = useCallback(async () => {
    if (!filePath) return
    setIsImporting(true)
    setProgress(null)

    try {
      const id = await startSqlImport(connectionId, filePath, stopOnError)
      setJobId(id)
    } catch (err) {
      setIsImporting(false)
      console.error('[sql-import] Failed to start import:', err)
    }
  }, [connectionId, filePath, stopOnError])

  // Handle cancel
  const handleCancel = useCallback(async () => {
    if (!jobId) return
    try {
      await cancelImport(jobId)
    } catch (err) {
      console.error('[sql-import] Failed to cancel import:', err)
    }
  }, [jobId])

  // Progress percentage
  const progressPercent = useMemo(() => {
    if (!progress || progress.statementsTotal === 0) return 0
    return Math.round((progress.statementsDone / progress.statementsTotal) * 100)
  }, [progress])

  // File name from path
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath

  return (
    <DialogShell
      isOpen={true}
      onClose={onClose}
      maxWidth={520}
      testId="sql-import-dialog"
      ariaLabel="Import SQL Script"
      disableFocusManagement={isPlaywright}
      nonDismissible={isImporting}
    >
      <div className={styles.root}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Import SQL Script</h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
            disabled={isImporting}
            data-testid="import-close-button"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
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
                onChange={(e) => setStopOnError(e.target.checked)}
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
                <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
              </div>
              <span className={styles.progressText}>
                {progress.statementsDone} / {progress.statementsTotal} statements —{' '}
                {progressPercent}%
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
                  {progress.errors.length > 1 ? 's' : ''}
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
              {progress.errors.map((err, i) => (
                <div key={i} className={styles.errorItem} data-testid={`import-error-${i}`}>
                  <strong>Statement #{err.statementIndex + 1}:</strong> {err.errorMessage}
                  {err.sqlPreview && <span className={styles.errorSql}>{err.sqlPreview}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className={styles.actions}>
            {!isTerminal && (
              <button
                type="button"
                className={styles.importButton}
                onClick={handleImport}
                disabled={isImporting}
                data-testid="import-submit-button"
              >
                {isImporting ? 'Importing...' : 'Import'}
              </button>
            )}
            {isImporting && (
              <button
                type="button"
                className={styles.cancelButton}
                onClick={handleCancel}
                data-testid="import-cancel-button"
              >
                Cancel Import
              </button>
            )}
            {isTerminal && (
              <button
                type="button"
                className={styles.cancelButton}
                onClick={onClose}
                data-testid="import-done-button"
              >
                Close
              </button>
            )}
            {!isImporting && !isTerminal && (
              <button
                type="button"
                className={styles.cancelButton}
                onClick={onClose}
                data-testid="import-dismiss-button"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <span className={styles.footerIcon}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
            </svg>
          </span>
          <p className={styles.footerText} data-testid="import-footer-text">
            Statements are executed sequentially. Large scripts may take several minutes. The import
            runs in the background.
          </p>
        </div>
      </div>
    </DialogShell>
  )
}
