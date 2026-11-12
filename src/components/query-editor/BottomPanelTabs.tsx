import { useCallback, useEffect, useMemo, useRef } from 'react'
import { CheckCircle, Table, Warning, X } from '@phosphor-icons/react'
import { useQueryStore, type SingleResultState } from '../../stores/query-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type { TableDataTab } from '../../types/schema'
import { UnderlineTabBar } from '../common/UnderlineTabs'
import { Button } from '../common/Button'
import { TAB_STRIP_NAVIGATION } from '../../lib/tab-strip-navigation'
import { isActivationKey, isMiddleMouseButton } from '../../lib/input-events'
import { hasResultColumns } from '../../lib/query-result-column-utils'
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
  if (!hasResultColumns(result)) {
    return <CheckCircle size={12} weight="fill" className={workspaceTabStyles.tabTypeIcon} />
  }
  return <Table size={16} weight="regular" className={workspaceTabStyles.tabTypeIcon} />
}

function bottomTabPanelId(item: BottomPanelTabItem, queryTabId: string): string {
  if (item.kind === 'result') return `result-tabpanel-${queryTabId}-${item.index}`
  return `table-data-tabpanel-${item.tab.id}`
}

function bottomTabTestId(item: BottomPanelTabItem): string {
  if (item.kind === 'result') return `bottom-panel-result-tab-${item.index}`
  return `bottom-panel-table-tab-${item.tab.id}`
}

function showsResultSeparator(
  items: BottomPanelTabItem[],
  index: number,
  resultCount: number
): boolean {
  if (index === 0) return false
  const item = items[index]
  if (item.kind !== 'table-data') return false
  return items[index - 1]?.kind === 'result' && resultCount > 0
}

function bottomTabStateProps(isActive: boolean) {
  return {
    className: `${styles.tab} ${isActive ? styles.tabActive : ''}`,
    'data-active': isActive ? true : undefined,
  }
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
      index: index,
      label: `Result ${index + 1}`,
      result: result,
    }))
    const tableItems = tableDataTabs.map((tab) => ({
      id: `table-${tab.id}`,
      kind: 'table-data' as const,
      tab: tab,
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

  const activateFocusedItem = useCallback(() => {
    const focusedIndex = tabRefs.current.findIndex((tab) => tab === document.activeElement)
    if (focusedIndex >= 0) {
      activateItem(items[focusedIndex])
    }
  }, [activateItem, items])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (items.length === 0) return
      if (isActivationKey(event.key)) {
        event.preventDefault()
        activateFocusedItem()
        return
      }
      const resolveTargetIndex = TAB_STRIP_NAVIGATION[event.key]
      if (!resolveTargetIndex) return
      event.preventDefault()
      activateItem(items[resolveTargetIndex(Math.max(activeItemIndex, 0), items.length)])
    },
    [activateFocusedItem, activateItem, activeItemIndex, items]
  )

  const handleCloseTableTab = useCallback(
    (tabId: string) => {
      closeTab(connectionId, tabId)
    },
    [closeTab, connectionId]
  )

  const hasSingleSurface = results.length <= 1 && tableDataTabs.length === 0
  if (hasSingleSurface) {
    return null
  }

  return (
    <div
      role="tablist"
      aria-label="Query bottom panel tabs"
      onKeyDown={handleKeyDown}
      data-testid="bottom-panel-tabs"
    >
      <UnderlineTabBar variant="selector" className={styles.strip} scrollable>
        {items.map((item, index) => {
          const isActive = item.id === activeItemId
          const panelId = bottomTabPanelId(item, queryTabId)
          const showSeparator = showsResultSeparator(items, index, results.length)

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
                {...bottomTabStateProps(isActive)}
                onMouseDown={(event) => {
                  const isMiddleClickOnTable =
                    isMiddleMouseButton(event) && item.kind === 'table-data'
                  if (isMiddleClickOnTable) {
                    event.preventDefault()
                    handleCloseTableTab(item.tab.id)
                  }
                }}
                data-testid={bottomTabTestId(item)}
              >
                <Button
                  variant="bare"
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
                      <Table
                        size={16}
                        weight="regular"
                        className={workspaceTabStyles.tabTypeIcon}
                      />
                    )}
                    <span className={workspaceTabStyles.tabLabelText}>{item.label}</span>
                  </span>
                </Button>
                {item.kind === 'table-data' && (
                  <Button
                    variant="bare"
                    className={`${workspaceTabStyles.tabClose} ${styles.closeButton}`}
                    aria-label={`Close ${item.tab.label} table`}
                    onClick={(event) => {
                      event.stopPropagation()
                      handleCloseTableTab(item.tab.id)
                    }}
                    data-testid={`bottom-panel-close-${item.tab.id}`}
                  >
                    <X size={12} weight="regular" />
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </UnderlineTabBar>
    </div>
  )
}
