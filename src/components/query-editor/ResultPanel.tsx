import { useQueryStore } from '../../stores/query-store'
import { ExpiredResultState } from './result-panel/ResultStatusViews'
import { ResultPanelDialogs } from './result-panel/ResultPanelDialogs'
import { ResultStatusView } from './result-panel/ResultBodies'
import {
  hasVisibleSubTabs,
  resolveDisplayStatus,
  shouldShowExpiredState,
} from './result-panel/result-panel-model'
import { buildResultBodyProps } from './result-panel/result-body-props'
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
    rowResidencyStatus: activeResult.rowResidency.status,
    resultStatus: activeResult.resultStatus,
  })
  const showsSubTabs = hasVisibleSubTabs(hideSubTabs, results.length)
  const body = buildResultBodyProps(
    {
      location: {
        tabId: tabId,
        connectionId: connectionId,
        isActive: isActive,
        hideSubTabs: hideSubTabs,
      },
      controllers: controllers,
      displayStatus: displayStatus,
      isTabRunning: tabStatus === 'running',
    },
    showsSubTabs
  )

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden bg-light-surface-container-lowest dark:bg-dark-surface-container-lowest"
      data-testid="result-panel"
      aria-busy={displayStatus === 'restoring'}
    >
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="expired-status">
        {shouldShowExpiredState(activeResult.isExpired, displayStatus) && (
          <ExpiredResultState
            isRestoring={displayStatus === 'restoring'}
            onRetry={handleRetryExpired}
          />
        )}
      </div>

      {!activeResult.isExpired && <ResultStatusView showsSubTabs={showsSubTabs} body={body} />}

      <ResultPanelDialogs
        tabId={tabId}
        connectionId={connectionId}
        activeResultIndex={controllers.activeResultIndex}
        result={activeResult}
        filter={controllers.filter}
        foreignKeyLookup={controllers.foreignKeyLookup}
      />
    </div>
  )
}
