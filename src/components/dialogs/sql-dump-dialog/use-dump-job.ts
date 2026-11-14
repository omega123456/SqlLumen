import { useCallback, useState } from 'react'
import {
  cancelDump,
  getDumpProgress,
  startSqlDump,
  type DumpJobProgress,
  type DumpOptions,
  type ExportableDatabase,
} from '../../../lib/sql-dump-commands'
import { showErrorToast, showSuccessToast } from '../../../stores/toast-store'
import { logFrontend, logFrontendError } from '../../../lib/app-log-commands'
import { toErrorMessage } from '../../../lib/error-message'
import { useJobProgressPolling } from '../../../hooks/useJobProgressPolling'
import { buildDumpTables, type TableSelection } from '../sql-dump-selection'

export interface DumpJobInputs {
  connectionId: string
  filePath: string
  onClose: () => void
}

export interface DumpRequest {
  options: DumpOptions
  selectedTables: TableSelection
  databases: ExportableDatabase[]
}

function cancelledMessage(progress: DumpJobProgress): string {
  return `Export cancelled — ${progress.tablesDone} of ${progress.tablesTotal} tables were written to the file`
}

function useCancelDump(jobId: string | null, connectionId: string) {
  const [cancelPending, setCancelPending] = useState(false)
  const cancelExport = useCallback(async () => {
    if (!jobId) return
    if (cancelPending) return
    setCancelPending(true)
    try {
      await cancelDump(jobId, connectionId)
    } catch (cancelError) {
      setCancelPending(false)
      logFrontendError('[sql-dump] Failed to cancel export:', cancelError)
    }
  }, [jobId, connectionId, cancelPending])
  return {
    cancelPending: cancelPending,
    setCancelPending: setCancelPending,
    cancelExport: cancelExport,
  }
}

function reportDumpFailure(progress: DumpJobProgress, setError: (message: string) => void) {
  showErrorToast('Export failed', progress.errorMessage ?? 'SQL dump failed')
  setError(progress.errorMessage ?? 'Export failed')
}

export function useDumpJob({ connectionId, filePath, onClose }: DumpJobInputs) {
  const [isExporting, setIsExporting] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<DumpJobProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { cancelPending, setCancelPending, cancelExport } = useCancelDump(jobId, connectionId)

  const handleDumpFinished = (finishedProgress: DumpJobProgress) => {
    setIsExporting(false)
    if (finishedProgress.status === 'completed') {
      showSuccessToast('Export completed', `SQL dump saved to ${filePath}`)
      onClose()
      return
    }
    if (finishedProgress.status === 'cancelled') {
      setCancelPending(false)
      setError(cancelledMessage(finishedProgress))
      return
    }
    reportDumpFailure(finishedProgress, setError)
  }

  useJobProgressPolling({
    jobId: jobId,
    fetchProgress: getDumpProgress,
    onProgress: setProgress,
    onFinished: handleDumpFinished,
    pollFailureMessage: '[sql-dump] Failed to poll progress:',
  })

  const startExport = async (request: DumpRequest) => {
    setIsExporting(true)
    setError(null)

    const dumpTables = buildDumpTables(request.selectedTables, request.databases)
    if (!dumpTables.ok) {
      setIsExporting(false)
      setError(dumpTables.message)
      logFrontend('error', `[sql-dump] ${dumpTables.message}`)
      return
    }

    try {
      const id = await startSqlDump({
        connectionId: connectionId,
        filePath: filePath,
        databases: dumpTables.databases,
        tables: dumpTables.tables,
        options: request.options,
      })
      setJobId(id)
    } catch (startError) {
      setIsExporting(false)
      setError(toErrorMessage(startError))
    }
  }

  return {
    isExporting: isExporting,
    progress: progress,
    error: error,
    cancelPending: cancelPending,
    startExport: startExport,
    cancelExport: cancelExport,
  }
}
