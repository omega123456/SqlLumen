/**
 * ResultSubTabs — compact horizontal tab strip for switching between
 * multiple query result sets within a single query editor tab.
 *
 * Only renders when results.length > 1.
 *
 * Accessibility: role="tablist" with roving tabIndex and arrow-key navigation.
 */

import { useCallback, useRef, useEffect } from 'react'
import { Table, CheckCircle, Warning } from '@phosphor-icons/react'
import { useQueryStore } from '../../stores/query-store'
import type { SingleResultState } from '../../stores/query-store'
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
  const setActiveResultIndex = useQueryStore((s) => s.setActiveResultIndex)

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
    (e: React.KeyboardEvent) => {
      let targetIndex: number | null = null
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        targetIndex = Math.min(activeResultIndex + 1, results.length - 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        targetIndex = Math.max(activeResultIndex - 1, 0)
      } else if (e.key === 'Home') {
        e.preventDefault()
        targetIndex = 0
      } else if (e.key === 'End') {
        e.preventDefault()
        targetIndex = results.length - 1
      }

      if (targetIndex !== null) {
        setActiveResultIndex(tabId, targetIndex)
        // Focus is moved by the useEffect on activeResultIndex change.
        // This ensures focus only lands on the tab if the switch actually committed
        // (it may be deferred by the unsaved-edits guard).
      }
    },
    [activeResultIndex, results.length, setActiveResultIndex, tabId]
  )

  if (results.length <= 1) return null

  return (
    <div
      className={styles.strip}
      role="tablist"
      aria-label="Query result sets"
      onKeyDown={handleKeyDown}
      data-testid="result-sub-tabs"
    >
      {results.map((result, index) => {
        const isActive = index === activeResultIndex
        return (
          <button
            key={index}
            ref={(el) => {
              tabRefs.current[index] = el
            }}
            type="button"
            role="tab"
            id={`result-tab-${tabId}-${index}`}
            aria-selected={isActive}
            aria-controls={`result-tabpanel-${tabId}-${index}`}
            tabIndex={isActive ? 0 : -1}
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            onClick={() => handleTabClick(index)}
            data-testid={`result-tab-${index}`}
          >
            {getTabIcon(result)}
            <span className={styles.tabLabel}>Result {index + 1}</span>
          </button>
        )
      })}
    </div>
  )
}
