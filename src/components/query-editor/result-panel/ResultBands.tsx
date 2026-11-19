import { useQueryStore, type SingleResultState } from '../../../stores/query-store'
import type { DataViewSurfaceRef } from '../../../stores/data-view/data-view-types'
import { formatCount, formatRowRange } from '../../../lib/format-row-count'
import { Button } from '../../common/Button'
import { InfoBar } from '../../common/InfoBar'
import { TRUNCATION_MESSAGES } from './result-panel-model'

interface ResultBandsProps {
  surfaceRef: DataViewSurfaceRef
  result: SingleResultState
  isTabRunning: boolean
}

interface TruncationBandProps {
  result: SingleResultState
  isTabRunning: boolean
  onExportAllRows: () => void
}

function TruncationBand({ result, isTabRunning, onExportAllRows }: TruncationBandProps) {
  const { fullExportBlockedReason } = result
  const exportAllButton = (
    <Button
      size="sm"
      onClick={onExportAllRows}
      disabled={isTabRunning}
      title={isTabRunning ? 'Wait for the query to finish.' : undefined}
      data-testid="truncation-export-all"
    >
      Export all rows…
    </Button>
  )
  return (
    <InfoBar
      severity="warning"
      polite
      title={`Showing the first ${formatCount(result.rowCeiling)} rows`}
      message={TRUNCATION_MESSAGES[fullExportBlockedReason ?? 'none']}
      actions={fullExportBlockedReason === null ? exportAllButton : undefined}
      data-testid="result-truncation-band"
    />
  )
}

function ViewErrorBand({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <InfoBar
      severity="error"
      title="Couldn't apply sort or filter"
      message={message}
      actions={
        <Button size="sm" onClick={onRetry} data-testid="view-error-retry">
          Retry
        </Button>
      }
      data-testid="result-view-error-band"
    />
  )
}

interface WindowFailureBandProps {
  failedWindowRange: NonNullable<SingleResultState['failedWindowRange']>
  onRetry: () => void
}

function WindowFailureBand({ failedWindowRange, onRetry }: WindowFailureBandProps) {
  const [rangeStart, rangeEnd] = failedWindowRange
  return (
    <InfoBar
      severity="error"
      title={`Couldn't load rows ${formatRowRange(rangeStart + 1, rangeEnd)}`}
      message="Retry to load these rows."
      actions={
        <Button size="sm" onClick={onRetry} data-testid="window-error-retry">
          Retry
        </Button>
      }
      data-testid="result-window-error-band"
    />
  )
}

interface FailureBandProps {
  surfaceRef: DataViewSurfaceRef
  result: SingleResultState
}

function FailureBand({ surfaceRef, result }: FailureBandProps) {
  const retryResultWindow = useQueryStore((state) => state.retryResultWindow)
  const retryViewChange = useQueryStore((state) => state.retryViewChange)
  const { viewError, failedWindowRange } = result
  if (viewError !== null) {
    return <ViewErrorBand message={viewError} onRetry={() => retryViewChange(surfaceRef)} />
  }
  if (failedWindowRange === null) return null
  return (
    <WindowFailureBand
      failedWindowRange={failedWindowRange}
      onRetry={() => retryResultWindow(surfaceRef)}
    />
  )
}

const RUN_FILE_TRUNCATION_MESSAGE =
  "The run file has every row, in query order. Sort and filter don't apply."

interface RunFileBandProps {
  result: SingleResultState
  exportedRowCount: number
  onCopyRunFilePath: () => void
}

function RunFileBand({ result, exportedRowCount, onCopyRunFilePath }: RunFileBandProps) {
  return (
    <InfoBar
      severity="warning"
      polite
      title={`Showing the first ${formatCount(result.rowCeiling)} of ${formatCount(exportedRowCount)} rows`}
      message={RUN_FILE_TRUNCATION_MESSAGE}
      actions={
        <Button size="sm" onClick={onCopyRunFilePath} data-testid="truncation-copy-run-path">
          Copy run file path
        </Button>
      }
      data-testid="result-truncation-band"
    />
  )
}

function ResultTruncationBand({ surfaceRef, result, isTabRunning }: ResultBandsProps) {
  const openExportDialog = useQueryStore((state) => state.openExportDialog)
  const copyLastRunFilePath = useQueryStore((state) => state.copyLastRunFilePath)
  const exportedRowCount = result.exportedRowCount
  if (exportedRowCount !== null) {
    return (
      <RunFileBand
        result={result}
        exportedRowCount={exportedRowCount}
        onCopyRunFilePath={() => void copyLastRunFilePath(surfaceRef.tabId)}
      />
    )
  }
  return (
    <TruncationBand
      result={result}
      isTabRunning={isTabRunning}
      onExportAllRows={() => openExportDialog(surfaceRef, 'allRows')}
    />
  )
}

function hasAnyBand(result: SingleResultState): boolean {
  return result.truncated || result.failedWindowRange !== null || result.viewError !== null
}

export function ResultBands({ surfaceRef, result, isTabRunning }: ResultBandsProps) {
  if (!hasAnyBand(result)) return null
  return (
    <div
      className="flex flex-none flex-col gap-2 border-t border-t-light-stroke-divider bg-light-surface-container-lowest p-3 dark:border-t-dark-stroke-divider dark:bg-dark-surface-container-lowest"
      data-testid="result-band-slot"
    >
      {result.truncated && (
        <ResultTruncationBand surfaceRef={surfaceRef} result={result} isTabRunning={isTabRunning} />
      )}
      <FailureBand surfaceRef={surfaceRef} result={result} />
    </div>
  )
}
