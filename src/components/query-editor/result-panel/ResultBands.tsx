import { useQueryStore, type SingleResultState } from '../../../stores/query-store'
import type { DataViewSurfaceRef } from '../../../stores/data-view/data-view-types'
import { formatCount } from '../../../lib/format-row-count'
import { DATA_VIEW_BAND_SLOT } from '../../../lib/class-names'
import { Button } from '../../common/Button'
import { InfoBar } from '../../common/InfoBar'
import { DataViewFailureBand } from '../../shared/data-view/body/DataViewFailureBand'
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
  return (
    result.truncated || result.view.window.failedRange !== null || result.view.spec.error !== null
  )
}

export function ResultBands({ surfaceRef, result, isTabRunning }: ResultBandsProps) {
  if (!hasAnyBand(result)) return null
  return (
    <div className={DATA_VIEW_BAND_SLOT} data-testid="result-band-slot">
      {result.truncated && (
        <ResultTruncationBand surfaceRef={surfaceRef} result={result} isTabRunning={isTabRunning} />
      )}
      <DataViewFailureBand surfaceRef={surfaceRef} />
    </div>
  )
}
