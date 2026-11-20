import type { DataViewSurfaceRef } from '../../../../stores/data-view/data-view-types'
import { useDataView } from '../../../../stores/data-view/use-data-view'
import { retryViewChange, retryWindow } from '../../../../stores/data-view/view-actions'
import type { ViewRange } from '../../../../lib/result-window-cache'
import { formatRowRange } from '../../../../lib/format-row-count'
import { Button } from '../../../common/Button'
import { InfoBar } from '../../../common/InfoBar'

interface DataViewFailureBandProps {
  surfaceRef: DataViewSurfaceRef
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
  failedWindowRange: ViewRange
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

export function DataViewFailureBand({ surfaceRef }: DataViewFailureBandProps) {
  const viewError = useDataView(surfaceRef, (view) => view.spec.error)
  const failedWindowRange = useDataView(surfaceRef, (view) => view.window.failedRange)
  if (viewError !== null) {
    return <ViewErrorBand message={viewError} onRetry={() => retryViewChange(surfaceRef)} />
  }
  if (failedWindowRange === null) return null
  return (
    <WindowFailureBand
      failedWindowRange={failedWindowRange}
      onRetry={() => retryWindow(surfaceRef)}
    />
  )
}
