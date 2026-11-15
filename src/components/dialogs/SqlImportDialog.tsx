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
import { joinClassNames, SCROLLBAR } from '../../lib/class-names'
import {
  DIALOG_CHECKBOX_LABEL,
  DIALOG_CHECKBOX_ROW,
  DIALOG_CLOSE_BUTTON,
  DIALOG_EDGE_TO_EDGE_ROOT,
  DIALOG_FORM_FIELD,
  DIALOG_FORM_LABEL,
  DIALOG_HEADER,
  DIALOG_HEADER_TITLE,
  DIALOG_JOB_BODY,
  DIALOG_JOB_FOOTER_GRID,
  DIALOG_PROGRESS_TRACK,
} from '../../lib/class-names-dialog'

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

type ImportStatusTone = 'neutral' | 'success'

const IMPORT_STATUS_TONE_CLASSES: Record<ImportStatusTone, string> = {
  neutral: 'text-light-on-surface-variant dark:text-dark-on-surface-variant',
  success: 'font-semibold text-light-primary dark:text-dark-primary',
}

function ImportStatusMessage({ progress }: { progress: ImportJobProgress }) {
  const tone: ImportStatusTone = isCleanCompletion(progress) ? 'success' : 'neutral'
  return (
    <div
      className={joinClassNames([
        'py-2 text-center font-body text-size-caption',
        IMPORT_STATUS_TONE_CLASSES[tone],
      ])}
      data-testid="import-status"
    >
      <ImportOutcomeText progress={progress} />
    </div>
  )
}

function ImportProgressPanel({ progress }: { progress: ImportJobProgress }) {
  const statementsPercent = progressPercent(progress.statementsDone, progress.statementsTotal)
  return (
    <div
      className="flex flex-col gap-2 bg-light-fill-control dark:bg-dark-fill-control"
      data-testid="import-progress"
    >
      <div className={joinClassNames([DIALOG_PROGRESS_TRACK, 'w-full'])}>
        <div
          className="h-full rounded-track bg-light-primary transition-width duration-300 dark:bg-dark-primary"
          style={{ width: `${statementsPercent}%` }}
        />
      </div>
      <span className="font-body text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
        {progress.statementsDone} / {progress.statementsTotal} statements — {statementsPercent}%
      </span>
    </div>
  )
}

function ImportErrorList({ errors }: { errors: ImportJobProgress['errors'] }) {
  if (errors.length === 0) return null
  return (
    <div
      className={joinClassNames(['flex max-h-40 flex-col gap-1.5 overflow-y-auto', SCROLLBAR])}
      data-testid="import-error-list"
    >
      {errors.map((error, index) => (
        <div
          key={index}
          className="rounded-card border border-light-stroke-card bg-light-error-container px-3 py-2 font-body text-size-caption text-light-error dark:border-dark-stroke-card dark:bg-dark-error-container dark:text-dark-error"
          data-testid={`import-error-${index}`}
        >
          <strong>Statement #{error.statementIndex + 1}:</strong> {error.errorMessage}
          {error.sqlPreview && (
            <span className="mt-1 block font-mono text-size-caption break-all whitespace-pre-wrap text-light-outline dark:text-dark-outline">
              {error.sqlPreview}
            </span>
          )}
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
      <div className={DIALOG_JOB_FOOTER_GRID}>
        {isImporting && cancelImportButton}
        <Button type="button" onClick={onClose} data-testid="import-done-button">
          Close
        </Button>
      </div>
    )
  }
  return (
    <div className={DIALOG_JOB_FOOTER_GRID}>
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

const IMPORT_DIALOG_MAX_WIDTH = 520

interface ImportJobInputs {
  connectionId: string
  filePath: string
  stopOnError: boolean
}

function useSqlImportJob({ connectionId, filePath, stopOnError }: ImportJobInputs) {
  const [isImporting, setIsImporting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<ImportJobProgress | null>(null)

  useJobProgressPolling({
    jobId: jobId,
    fetchProgress: getImportProgress,
    onProgress: setProgress,
    onFinished: (finishedProgress: ImportJobProgress) => {
      setIsImporting(false)
      announceImportOutcome(finishedProgress)
    },
    pollFailureMessage: '[sql-import] Failed to poll progress:',
  })

  const startImport = useCallback(async () => {
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

  const cancelRunningImport = useCallback(async () => {
    if (!jobId) return
    try {
      await cancelImport(jobId)
    } catch (error) {
      logFrontendError('[sql-import] Failed to cancel import:', error)
    }
  }, [jobId])

  return {
    isImporting: isImporting,
    progress: progress,
    startImport: startImport,
    cancelRunningImport: cancelRunningImport,
  }
}

function ImportDialogHeader({
  isImporting,
  onClose,
}: {
  isImporting: boolean
  onClose: () => void
}) {
  return (
    <div className={DIALOG_HEADER}>
      <h2 className={DIALOG_HEADER_TITLE}>Import SQL script</h2>
      <Button
        variant="bare"
        className={joinClassNames([DIALOG_CLOSE_BUTTON, 'svg:size-5'])}
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
  )
}

interface ImportOptionsProps {
  fileName: string
  stopOnError: boolean
  onStopOnErrorChange: (checked: boolean) => void
  disabled: boolean
}

function ImportFileAndOptions({
  fileName,
  stopOnError,
  onStopOnErrorChange,
  disabled,
}: ImportOptionsProps) {
  return (
    <>
      <div className={DIALOG_FORM_FIELD}>
        <span className={DIALOG_FORM_LABEL}>File</span>
        <div
          className="rounded-control border border-light-stroke-control bg-light-fill-control px-2.5 py-1.25 font-mono text-size-mono leading-5 break-all text-light-on-surface dark:border-dark-stroke-control dark:bg-dark-fill-control dark:text-dark-on-surface"
          data-testid="import-file-path"
        >
          {fileName}
        </div>
      </div>
      <div className={DIALOG_FORM_FIELD}>
        <span className={DIALOG_FORM_LABEL}>Options</span>
        <div className={DIALOG_CHECKBOX_ROW}>
          <Checkbox
            id="import-stop-on-error"
            checked={stopOnError}
            onChange={(event) => onStopOnErrorChange(event.target.checked)}
            disabled={disabled}
            data-testid="import-stop-on-error"
          />
          <label htmlFor="import-stop-on-error" className={DIALOG_CHECKBOX_LABEL}>
            Stop on first error
          </label>
        </div>
      </div>
    </>
  )
}

function ImportProgressDetails({
  progress,
  isTerminal,
}: {
  progress: ImportJobProgress | null
  isTerminal: boolean
}) {
  if (!progress) return null
  return (
    <>
      <ImportProgressPanel progress={progress} />
      {isTerminal && <ImportStatusMessage progress={progress} />}
      <ImportErrorList errors={progress.errors} />
    </>
  )
}

export default function SqlImportDialog({ connectionId, filePath, onClose }: SqlImportDialogProps) {
  const [stopOnError, setStopOnError] = useState(true)
  const job = useSqlImportJob({
    connectionId: connectionId,
    filePath: filePath,
    stopOnError: stopOnError,
  })
  const { isImporting, progress } = job
  const isTerminal = isTerminalJobStatus(progress?.status)

  return (
    <DialogShell
      isOpen={true}
      onClose={onClose}
      maxWidth={IMPORT_DIALOG_MAX_WIDTH}
      testId="sql-import-dialog"
      ariaLabel="Import SQL script"
      disableFocusManagement={isPlaywrightBuild()}
      nonDismissible={isImporting}
    >
      <div className={DIALOG_EDGE_TO_EDGE_ROOT}>
        <ImportDialogHeader isImporting={isImporting} onClose={onClose} />
        <div className={DIALOG_JOB_BODY}>
          <ImportFileAndOptions
            fileName={fileNameFromPath(filePath)}
            stopOnError={stopOnError}
            onStopOnErrorChange={setStopOnError}
            disabled={isImporting || isTerminal}
          />
          <ImportProgressDetails progress={progress} isTerminal={isTerminal} />
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
            onImport={job.startImport}
            onCancelImport={job.cancelRunningImport}
            onClose={onClose}
          />
        </div>
      </div>
    </DialogShell>
  )
}
