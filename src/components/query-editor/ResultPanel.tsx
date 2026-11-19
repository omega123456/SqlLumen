import { useQueryStore } from '../../stores/query-store'
import { ExpiredResultState, ResultStatusView } from './result-panel/ResultStatusViews'
import {
  hasVisibleSubTabs,
  resolveDisplayStatus,
  shouldShowExpiredState,
} from './result-panel/result-panel-model'
import {
  useResultPanelControllers,
  useRetryExpiredResult,
} from './result-panel/use-result-panel-controllers'

interface ResultPanelProps {
  tabId: string
  connectionId: string
  isActive?: boolean
  hideSubTabs?: boolean
}

const EMPTY_RESULTS: readonly unknown[] = []

export function ResultPanel({
  tabId,
  connectionId,
  isActive = true,
  hideSubTabs = false,
}: ResultPanelProps) {
  const tabStatus = useQueryStore((state) => state.tabs[tabId]?.tabStatus ?? 'idle')
  const results = useQueryStore((state) => state.tabs[tabId]?.results ?? EMPTY_RESULTS)
  const controllers = useResultPanelControllers(tabId, isActive)
  const handleRetryExpired = useRetryExpiredResult(tabId)
  const { activeResult } = controllers

  const displayStatus = resolveDisplayStatus({
    tabStatus: tabStatus,
    rowResidencyStatus: activeResult.view.residency.rows.status,
    resultStatus: activeResult.resultStatus,
  })
  const location = {
    tabId: tabId,
    connectionId: connectionId,
    hideSubTabs: hideSubTabs,
    showsSubTabs: hasVisibleSubTabs(hideSubTabs, results.length),
  }

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden bg-light-surface-container-lowest dark:bg-dark-surface-container-lowest"
      data-testid="result-panel"
      aria-busy={displayStatus === 'restoring'}
    >
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="expired-status">
        {shouldShowExpiredState(activeResult.view.residency.isExpired, displayStatus) && (
          <ExpiredResultState
            isRestoring={displayStatus === 'restoring'}
            onRetry={handleRetryExpired}
          />
        )}
      </div>

      {!activeResult.view.residency.isExpired && (
        <ResultStatusView
          location={location}
          controllers={controllers}
          displayStatus={displayStatus}
          isTabRunning={tabStatus === 'running'}
        />
      )}
    </div>
  )
}
