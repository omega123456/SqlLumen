/**
 * ResultSubTabs — horizontal tab strip for switching between
 * multiple query result sets within a single query editor tab.
 *
 * Only renders when results.length > 1. A result that hit the row ceiling
 * shows a warning indicator after its label (accessible name includes
 * "truncated", tooltip "Truncated at {ceiling} rows").
 *
 * Uses the shared UnderlineTabBar container so its height, border, and
 * scrollbar match the top-level workspace tabs. Individual tab styling
 * replicates the workspace tab metrics via shared CSS tokens.
 *
 * Accessibility: role="tablist" with roving tabIndex and arrow-key navigation.
 */

import { useCallback, useRef, useEffect } from 'react'
import { Table, CheckCircle, Warning, WarningCircle } from '@phosphor-icons/react'
import { formatCount } from '../../lib/format-row-count'
import { useQueryStore } from '../../stores/query-store'
import type { SingleResultState } from '../../stores/query-store'
import { UnderlineTabBar } from '../common/UnderlineTabs'
import { Button } from '../common/Button'
import styles from './ResultSubTabs.module.css'

interface ResultSubTabsProps {
  tabId: string
}

function getTabIcon(result: SingleResultState) {
  if (result.resultStatus === 'error') {
    return <Warning size={12} weight="fill" className={styles.errorIcon} />
  }
  if (result.columns.length === 0) {
    return <CheckCircle size={12} weight="fill" className={styles.dmlIcon} />
  }
  return <Table size={12} weight="fill" className={styles.selectIcon} />
}

export function ResultSubTabs({ tabId }: ResultSubTabsProps) {
  const tabState = useQueryStore((state) => state.tabs[tabId])
  const setActiveResultIndex = useQueryStore((state) => state.setActiveResultIndex)

  const results = tabState?.results ?? []
  const activeResultIndex = tabState?.activeResultIndex ?? 0
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Scroll active tab into view and move focus on keyboard navigation
  useEffect(() => {
    const activeTab = tabRefs.current[activeResultIndex]
    if (activeTab) {
      activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      // Move focus to the active tab if focus is within the tablist
      // (i.e., during keyboard navigation, not mouse clicks)
      if (activeTab.closest('[role="tablist"]')?.contains(document.activeElement)) {
        activeTab.focus()
      }
    }
  }, [activeResultIndex])

  const handleTabClick = useCallback(
    (index: number) => {
      setActiveResultIndex(tabId, index)
    },
    [setActiveResultIndex, tabId]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      let targetIndex: number | null = null
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        targetIndex = Math.min(activeResultIndex + 1, results.length - 1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        targetIndex = Math.max(activeResultIndex - 1, 0)
      } else if (event.key === 'Home') {
        event.preventDefault()
        targetIndex = 0
      } else if (event.key === 'End') {
        event.preventDefault()
        targetIndex = results.length - 1
      }

      if (targetIndex !== null) {
        setActiveResultIndex(tabId, targetIndex)
      }
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
      <UnderlineTabBar variant="selector" className={styles.strip} scrollable>
        {results.map((result, index) => {
          const isActive = index === activeResultIndex
          return (
            <Button
              variant="bare"
              key={index}
              ref={(element) => {
                tabRefs.current[index] = element
              }}
              role="tab"
              id={`result-tab-${tabId}-${index}`}
              aria-selected={isActive}
              aria-controls={`result-tabpanel-${tabId}-${index}`}
              tabIndex={isActive ? 0 : -1}
              aria-label={result.truncated ? `Result ${index + 1} truncated` : undefined}
              className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
              onClick={() => handleTabClick(index)}
              data-testid={`result-tab-${index}`}
            >
              <span className={styles.tabLabel}>
                {getTabIcon(result)}
                <span>Result {index + 1}</span>
                {result.truncated && (
                  <span
                    className={styles.truncatedIndicator}
                    title={`Truncated at ${formatCount(result.rowCeiling)} rows`}
                    data-testid={`result-tab-${index}-truncated`}
                  >
                    <WarningCircle size={12} weight="fill" aria-hidden="true" />
                  </span>
                )}
              </span>
            </Button>
          )
        })}
      </UnderlineTabBar>
    </div>
  )
}
