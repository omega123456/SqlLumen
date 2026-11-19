import { useCallback } from 'react'
import { useRevealActiveTab } from '../../hooks/use-reveal-active-tab'
import { Table, CheckCircle, Warning, WarningCircle } from '@phosphor-icons/react'
import { formatCount } from '../../lib/format-row-count'
import { useQueryStore } from '../../stores/query-store'
import type { SingleResultState } from '../../stores/query-store'
import { UnderlineTabBar } from '../common/UnderlineTabs'
import { Button } from '../common/Button'
import { TAB_STRIP_NAVIGATION } from '../../lib/tab-strip-navigation'
import { hasResultColumns } from '../../lib/query-result-column-utils'
import { joinClassNames } from '../../lib/class-names'
import { FOCUS_RING } from '../../lib/focus-ring'
import {
  RESULT_TAB_ACTIVITY_CLASSES,
  RESULT_TAB_FRAME,
  resultTabActivityOf,
  type ResultTabActivity,
} from '../../lib/class-names-result-tab'

interface ResultSubTabsProps {
  tabId: string
}

const ICON_TONE_CLASSES: Record<ResultTabActivity, string> = {
  idle: '',
  active: 'text-light-primary dark:text-dark-primary',
}

function getTabIcon(result: SingleResultState, activity: ResultTabActivity) {
  if (result.resultStatus === 'error') {
    return <Warning size={12} weight="fill" className="text-light-error dark:text-dark-error" />
  }
  if (!hasResultColumns(result.view.slot)) {
    return <CheckCircle size={12} weight="fill" className={ICON_TONE_CLASSES[activity]} />
  }
  return <Table size={12} weight="fill" className={ICON_TONE_CLASSES[activity]} />
}

interface ResultSubTabProps {
  tabId: string
  index: number
  result: SingleResultState
  isActive: boolean
  registerTab: (index: number, element: HTMLButtonElement | null) => void
  onSelect: (index: number) => void
}

function ResultSubTab({
  tabId,
  index,
  result,
  isActive,
  registerTab,
  onSelect,
}: ResultSubTabProps) {
  const activity = resultTabActivityOf(isActive)
  return (
    <Button
      variant="bare"
      ref={(element) => registerTab(index, element)}
      role="tab"
      id={`result-tab-${tabId}-${index}`}
      aria-selected={isActive}
      aria-controls={`result-tabpanel-${tabId}-${index}`}
      tabIndex={isActive ? 0 : -1}
      aria-label={result.truncated ? `Result ${index + 1} truncated` : undefined}
      className={joinClassNames([
        RESULT_TAB_FRAME,
        'px-3.5',
        RESULT_TAB_ACTIVITY_CLASSES[activity],
        FOCUS_RING,
      ])}
      onClick={() => onSelect(index)}
      data-testid={`result-tab-${index}`}
    >
      <span className="inline-flex items-center gap-2 whitespace-nowrap">
        {getTabIcon(result, activity)}
        <span>Result {index + 1}</span>
        {result.truncated && (
          <span
            className="inline-flex items-center text-light-warning dark:text-dark-warning"
            title={`Truncated at ${formatCount(result.rowCeiling)} rows`}
            data-testid={`result-tab-${index}-truncated`}
          >
            <WarningCircle size={12} weight="fill" aria-hidden="true" />
          </span>
        )}
      </span>
    </Button>
  )
}

export function ResultSubTabs({ tabId }: ResultSubTabsProps) {
  const tabState = useQueryStore((state) => state.tabs[tabId])
  const setActiveResultIndex = useQueryStore((state) => state.setActiveResultIndex)

  const results = tabState?.results ?? []
  const activeResultIndex = tabState?.activeResultIndex ?? 0
  const { registerTab } = useRevealActiveTab(activeResultIndex)

  const handleTabClick = useCallback(
    (index: number) => {
      setActiveResultIndex(tabId, index)
    },
    [setActiveResultIndex, tabId]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const resolveTargetIndex = TAB_STRIP_NAVIGATION[event.key]
      if (!resolveTargetIndex) return
      event.preventDefault()
      setActiveResultIndex(tabId, resolveTargetIndex(activeResultIndex, results.length))
    },
    [activeResultIndex, results.length, setActiveResultIndex, tabId]
  )

  if (results.length <= 1) return null

  return (
    <div
      role="tablist"
      aria-label="Query result sets"
      onKeyDown={handleKeyDown}
      data-testid="result-sub-tabs"
    >
      <UnderlineTabBar variant="selector" className="px-2" scrollable>
        {results.map((result, index) => (
          <ResultSubTab
            key={index}
            tabId={tabId}
            index={index}
            result={result}
            isActive={index === activeResultIndex}
            registerTab={registerTab}
            onSelect={handleTabClick}
          />
        ))}
      </UnderlineTabBar>
    </div>
  )
}
