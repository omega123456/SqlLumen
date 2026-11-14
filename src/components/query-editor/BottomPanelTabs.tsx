import { useCallback, useMemo, type KeyboardEvent } from 'react'
import { useQueryStore } from '../../stores/query-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type { TableDataTab } from '../../types/schema'
import { UnderlineTabBar } from '../common/UnderlineTabs'
import { TAB_STRIP_NAVIGATION } from '../../lib/tab-strip-navigation'
import { isActivationKey } from '../../lib/input-events'
import { isScopedTableDataTabOf } from '../../lib/workspace-tab-stacks'
import { useRevealActiveTab } from '../../hooks/use-reveal-active-tab'
import { BottomPanelTab } from './bottom-panel-tabs/BottomPanelTab'
import {
  activeBottomPanelItemId,
  buildBottomPanelTabItems,
  showsResultSeparator,
  type BottomPanelTabItem,
} from './bottom-panel-tabs/bottom-panel-tab-items'
import styles from './BottomPanelTabs.module.css'

interface BottomPanelTabsProps {
  queryTabId: string
  connectionId: string
}

const DEFAULT_ACTIVE_BOTTOM_PANEL_ITEM = { type: 'result' } as const

function useBottomPanelTabItems(queryTabId: string, connectionId: string) {
  const queryTabState = useQueryStore((state) => state.tabs[queryTabId])
  const results = useMemo(() => queryTabState?.results ?? [], [queryTabState?.results])
  const activeBottomPanelItem =
    queryTabState?.activeBottomPanelItem ?? DEFAULT_ACTIVE_BOTTOM_PANEL_ITEM
  const activeResultIndex = queryTabState?.activeResultIndex ?? 0
  const connectionTabs = useWorkspaceStore((state) => state.tabsByConnection[connectionId] ?? [])
  const tableDataTabs = useMemo(
    () =>
      connectionTabs.filter((tab): tab is TableDataTab => isScopedTableDataTabOf(tab, queryTabId)),
    [connectionTabs, queryTabId]
  )
  const items = useMemo(
    () => buildBottomPanelTabItems(queryTabId, results, tableDataTabs),
    [queryTabId, results, tableDataTabs]
  )
  const activeItemId = activeBottomPanelItemId({
    queryTabId: queryTabId,
    activeBottomPanelItem: activeBottomPanelItem,
    activeResultIndex: activeResultIndex,
  })
  const hasSingleSurface = results.length <= 1 && tableDataTabs.length === 0
  return {
    items: items,
    activeItemId: activeItemId,
    resultCount: results.length,
    hasSingleSurface: hasSingleSurface,
  }
}

function useActivateBottomPanelItem(queryTabId: string) {
  const setActiveResultIndex = useQueryStore((state) => state.setActiveResultIndex)
  const setActiveBottomPanelItem = useQueryStore((state) => state.setActiveBottomPanelItem)
  return useCallback(
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
}

interface TabStripKeyboardInputs {
  items: BottomPanelTabItem[]
  activeItemIndex: number
  focusedTabIndex: () => number
  activateItem: (item: BottomPanelTabItem) => void
}

function useTabStripKeyDown(inputs: TabStripKeyboardInputs) {
  const { items, activeItemIndex, focusedTabIndex, activateItem } = inputs
  return useCallback(
    (event: KeyboardEvent) => {
      if (items.length === 0) return
      if (isActivationKey(event.key)) {
        event.preventDefault()
        const focusedIndex = focusedTabIndex()
        if (focusedIndex >= 0) activateItem(items[focusedIndex])
        return
      }
      const resolveTargetIndex = TAB_STRIP_NAVIGATION[event.key]
      if (!resolveTargetIndex) return
      event.preventDefault()
      activateItem(items[resolveTargetIndex(Math.max(activeItemIndex, 0), items.length)])
    },
    [activateItem, activeItemIndex, focusedTabIndex, items]
  )
}

export function BottomPanelTabs({ queryTabId, connectionId }: BottomPanelTabsProps) {
  const { items, activeItemId, resultCount, hasSingleSurface } = useBottomPanelTabItems(
    queryTabId,
    connectionId
  )
  const closeTab = useWorkspaceStore((state) => state.closeTab)
  const activeItemIndex = items.findIndex((item) => item.id === activeItemId)
  const { registerTab, focusedTabIndex } = useRevealActiveTab(activeItemIndex)
  const activateItem = useActivateBottomPanelItem(queryTabId)
  const handleKeyDown = useTabStripKeyDown({
    items: items,
    activeItemIndex: activeItemIndex,
    focusedTabIndex: focusedTabIndex,
    activateItem: activateItem,
  })
  const handleCloseTableTab = useCallback(
    (tabId: string) => closeTab(connectionId, tabId),
    [closeTab, connectionId]
  )

  if (hasSingleSurface) return null

  return (
    <div
      role="tablist"
      aria-label="Query bottom panel tabs"
      onKeyDown={handleKeyDown}
      data-testid="bottom-panel-tabs"
    >
      <UnderlineTabBar variant="selector" className={styles.strip} scrollable>
        {items.map((item, index) => (
          <BottomPanelTab
            key={item.id}
            item={item}
            index={index}
            queryTabId={queryTabId}
            isActive={item.id === activeItemId}
            showSeparator={showsResultSeparator(items, index, resultCount)}
            registerTab={registerTab}
            onActivate={activateItem}
            onCloseTableTab={handleCloseTableTab}
          />
        ))}
      </UnderlineTabBar>
    </div>
  )
}
