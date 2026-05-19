import { useCallback, useEffect, useMemo, useRef } from 'react'
import { CheckCircle, Table, Warning, X } from '@phosphor-icons/react'
import { useQueryStore, type SingleResultState } from '../../stores/query-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type { TableDataTab } from '../../types/schema'
import { UnderlineTabBar } from '../common/UnderlineTabs'
import styles from './BottomPanelTabs.module.css'
import workspaceTabStyles from '../workspace/WorkspaceTabs.module.css'

interface BottomPanelTabsProps {
  queryTabId: string
  connectionId: string
}

const DEFAULT_ACTIVE_BOTTOM_PANEL_ITEM = { type: 'result' } as const

type BottomPanelTabItem =
  | { id: string; kind: 'result'; index: number; label: string; result: SingleResultState }
  | { id: string; kind: 'table-data'; tab: TableDataTab; label: string }

function getResultTabIcon(result: SingleResultState) {
  if (result.resultStatus === 'error') {
    return (
      <Warning
        size={12}
        weight="fill"
        className={`${workspaceTabStyles.tabTypeIcon} ${styles.errorIcon}`}
      />
    )
  }
  if (result.columns.length === 0) {
    return <CheckCircle size={12} weight="fill" className={workspaceTabStyles.tabTypeIcon} />
  }
  return <Table size={12} weight="fill" className={workspaceTabStyles.tabTypeIcon} />
}

export function BottomPanelTabs({ queryTabId, connectionId }: BottomPanelTabsProps) {
  const queryTabState = useQueryStore((state) => state.tabs[queryTabId])
  const results = useMemo(() => queryTabState?.results ?? [], [queryTabState?.results])
  const activeResultIndex = queryTabState?.activeResultIndex ?? 0
  const activeBottomPanelItem =
    queryTabState?.activeBottomPanelItem ?? DEFAULT_ACTIVE_BOTTOM_PANEL_ITEM
  const setActiveResultIndex = useQueryStore((state) => state.setActiveResultIndex)
  const setActiveBottomPanelItem = useQueryStore((state) => state.setActiveBottomPanelItem)
  const closeTab = useWorkspaceStore((state) => state.closeTab)
  const connectionTabs = useWorkspaceStore((state) => state.tabsByConnection[connectionId] ?? [])
  const tableDataTabs = useMemo(
    () =>
      connectionTabs.filter(
        (tab): tab is TableDataTab =>
          tab.type === 'table-data' && tab.parentQueryTabId === queryTabId
      ),
    [connectionTabs, queryTabId]
  )

  const items = useMemo<BottomPanelTabItem[]>(() => {
    const resultItems = results.map((result, index) => ({
      id: `result-${queryTabId}-${index}`,
      kind: 'result' as const,
      index,
      label: `Result ${index + 1}`,
      result,
    }))
    const tableItems = tableDataTabs.map((tab) => ({
      id: `table-${tab.id}`,
      kind: 'table-data' as const,
      tab,
      label: tab.label,
    }))
    return [...resultItems, ...tableItems]
  }, [queryTabId, results, tableDataTabs])

  const activeItemId = useMemo(() => {
    if (activeBottomPanelItem.type === 'table-data') {
      return `table-${activeBottomPanelItem.tabId}`
    }
    return `result-${queryTabId}-${activeResultIndex}`
  }, [activeBottomPanelItem, activeResultIndex, queryTabId])

  const activeItemIndex = items.findIndex((item) => item.id === activeItemId)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    const activeTab = activeItemIndex >= 0 ? tabRefs.current[activeItemIndex] : null
    if (!activeTab) return
    activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    if (activeTab.closest('[role="tablist"]')?.contains(document.activeElement)) {
      activeTab.focus()
    }
  }, [activeItemIndex])

  const activateItem = useCallback(
    (item: BottomPanelTabItem) => {
      if (item.kind === 'result') {
        setActiveBottomPanelItem(queryTabId, { type: 'result' })
        setActiveResultIndex(queryTabId, item.index)
        return
      }
      setActiveBottomPanelItem(queryTabId, { type: 'table-data', tabId: item.tab.id })
    },
    [queryTabId, setActiveBottomPanelItem, setActiveResultIndex]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (items.length === 0) return

      let targetIndex: number | null = null
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        targetIndex = Math.min((activeItemIndex >= 0 ? activeItemIndex : 0) + 1, items.length - 1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        targetIndex = Math.max((activeItemIndex >= 0 ? activeItemIndex : 0) - 1, 0)
      } else if (event.key === 'Home') {
        event.preventDefault()
        targetIndex = 0
      } else if (event.key === 'End') {
        event.preventDefault()
        targetIndex = items.length - 1
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const focusedIndex = tabRefs.current.findIndex((tab) => tab === document.activeElement)
        if (focusedIndex >= 0) {
          activateItem(items[focusedIndex])
        }
      }

      if (targetIndex !== null) {
        activateItem(items[targetIndex])
      }
    },
    [activateItem, activeItemIndex, items]
  )

  const handleCloseTableTab = useCallback(
    (tabId: string) => {
      closeTab(connectionId, tabId)
    },
    [closeTab, connectionId]
  )

  if (results.length <= 1 && tableDataTabs.length === 0) {
    return null
  }

  return (
    <div
      role="tablist"
      aria-label="Query bottom panel tabs"
      onKeyDown={handleKeyDown}
      data-testid="bottom-panel-tabs"
    >
      <UnderlineTabBar className={styles.strip} scrollable>
        {items.map((item, index) => {
          const isActive = item.id === activeItemId
          const panelId =
            item.kind === 'result'
              ? `result-tabpanel-${queryTabId}-${item.index}`
              : `table-data-tabpanel-${item.tab.id}`
          const showSeparator =
            item.kind === 'table-data' &&
            index > 0 &&
            items[index - 1]?.kind === 'result' &&
            results.length > 0

          return (
            <div key={item.id} className={styles.item}>
              {showSeparator && (
                <div
                  className={styles.separator}
                  aria-hidden="true"
                  data-testid="bottom-panel-tabs-separator"
                />
              )}
              <div
                className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
                data-active={isActive ? true : undefined}
                onMouseDown={(event) => {
                  if (event.button === 1 && item.kind === 'table-data') {
                    event.preventDefault()
                    handleCloseTableTab(item.tab.id)
                  }
                }}
                data-testid={
                  item.kind === 'result'
                    ? `bottom-panel-result-tab-${item.index}`
                    : `bottom-panel-table-tab-${item.tab.id}`
                }
              >
                <button
                  type="button"
                  ref={(element) => {
                    tabRefs.current[index] = element
                  }}
                  role="tab"
                  id={item.id}
                  aria-selected={isActive}
                  aria-controls={panelId}
                  tabIndex={isActive ? 0 : -1}
                  className={styles.tabButton}
                  onClick={() => activateItem(item)}
                >
                  <span className={workspaceTabStyles.tabLabel}>
                    {item.kind === 'result' ? (
                      getResultTabIcon(item.result)
                    ) : (
                      <Table size={12} weight="fill" className={workspaceTabStyles.tabTypeIcon} />
                    )}
                    <span className={workspaceTabStyles.tabLabelText}>{item.label}</span>
                  </span>
                </button>
                {item.kind === 'table-data' && (
                  <button
                    type="button"
                    className={`${workspaceTabStyles.tabClose} ${styles.closeButton}`}
                    aria-label={`Close ${item.tab.label} table`}
                    onClick={(event) => {
                      event.stopPropagation()
                      handleCloseTableTab(item.tab.id)
                    }}
                    data-testid={`bottom-panel-close-${item.tab.id}`}
                  >
                    <X size={12} weight="bold" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </UnderlineTabBar>
    </div>
  )
}
