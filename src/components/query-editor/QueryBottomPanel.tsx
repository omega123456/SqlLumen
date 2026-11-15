import { useEffect, useMemo, type ComponentPropsWithoutRef } from 'react'
import { useQueryStore, type ActiveBottomPanelItem } from '../../stores/query-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { ResultPanel } from './ResultPanel'
import { TableDataTab } from '../table-data/TableDataTab'
import type { TableDataTab as TableDataTabType } from '../../types/schema'
import { isScopedTableDataTabOf } from '../../lib/workspace-tab-stacks'

interface QueryBottomPanelProps {
  queryTabId: string
  connectionId: string
  isActive?: boolean
}

const DEFAULT_ACTIVE_BOTTOM_PANEL_ITEM = { type: 'result' } as const

function BottomPanelSlot(attributes: ComponentPropsWithoutRef<'div'>) {
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden" {...attributes} />
}

interface ResultTabPanelProps {
  queryTabId: string
  connectionId: string
  resultIndex: number
  activeResultIndex: number
  isResultActive: boolean
}

function ResultTabPanel(props: ResultTabPanelProps) {
  const { queryTabId, resultIndex, isResultActive } = props
  const isActiveResultPanel = resultIndex === props.activeResultIndex
  return (
    <BottomPanelSlot
      role="tabpanel"
      id={`result-tabpanel-${queryTabId}-${resultIndex}`}
      aria-labelledby={`result-${queryTabId}-${resultIndex}`}
      hidden={!isResultActive}
      data-testid={
        isActiveResultPanel
          ? 'query-bottom-panel-results'
          : `query-bottom-panel-result-${resultIndex}`
      }
    >
      {isResultActive && (
        <ResultPanel
          tabId={queryTabId}
          connectionId={props.connectionId}
          isActive={true}
          hideSubTabs
        />
      )}
    </BottomPanelSlot>
  )
}

interface TableTabPanelProps {
  tab: TableDataTabType
  isPanelActive: boolean
  isTableActive: boolean
}

function TableTabPanel({ tab, isPanelActive, isTableActive }: TableTabPanelProps) {
  return (
    <BottomPanelSlot
      role="tabpanel"
      id={`table-data-tabpanel-${tab.id}`}
      aria-labelledby={`table-${tab.id}`}
      hidden={!isTableActive}
      data-testid={`query-bottom-panel-table-${tab.id}`}
    >
      {isPanelActive && (
        <TableDataTab tab={tab} isActive={isTableActive} renderMode="bottom-panel" />
      )}
    </BottomPanelSlot>
  )
}

function isActiveTableItem(item: ActiveBottomPanelItem, tabId: string): boolean {
  return item.type === 'table-data' && item.tabId === tabId
}

function useScopedTableTabs(connectionId: string, queryTabId: string) {
  const connectionTabs = useWorkspaceStore((state) => state.tabsByConnection[connectionId] ?? [])
  return useMemo(
    () =>
      connectionTabs.filter((tab): tab is TableDataTabType =>
        isScopedTableDataTabOf(tab, queryTabId)
      ),
    [connectionTabs, queryTabId]
  )
}

function useFallBackToResultWhenTableTabCloses(
  queryTabId: string,
  activeBottomPanelItem: ActiveBottomPanelItem,
  scopedTableTabs: TableDataTabType[]
) {
  const setActiveBottomPanelItem = useQueryStore((state) => state.setActiveBottomPanelItem)
  const hasActiveTableTab = scopedTableTabs.some((tab) =>
    isActiveTableItem(activeBottomPanelItem, tab.id)
  )
  useEffect(() => {
    if (activeBottomPanelItem.type !== 'table-data') return
    if (hasActiveTableTab) return
    setActiveBottomPanelItem(queryTabId, { type: 'result' })
  }, [activeBottomPanelItem, hasActiveTableTab, queryTabId, setActiveBottomPanelItem])
}

export function QueryBottomPanel({
  queryTabId,
  connectionId,
  isActive = true,
}: QueryBottomPanelProps) {
  const queryTabState = useQueryStore((state) => state.tabs[queryTabId])
  const results = queryTabState?.results ?? []
  const activeBottomPanelItem = useQueryStore(
    (state) => state.tabs[queryTabId]?.activeBottomPanelItem ?? DEFAULT_ACTIVE_BOTTOM_PANEL_ITEM
  )
  const activeResultIndex = queryTabState?.activeResultIndex ?? 0
  const scopedTableTabs = useScopedTableTabs(connectionId, queryTabId)
  useFallBackToResultWhenTableTabCloses(queryTabId, activeBottomPanelItem, scopedTableTabs)
  const isResultItemShown = isActive && activeBottomPanelItem.type === 'result'

  return (
    <BottomPanelSlot data-testid="query-bottom-panel">
      {results.map((_, resultIndex) => (
        <ResultTabPanel
          key={`result-panel-${resultIndex}`}
          queryTabId={queryTabId}
          connectionId={connectionId}
          resultIndex={resultIndex}
          activeResultIndex={activeResultIndex}
          isResultActive={isResultItemShown && activeResultIndex === resultIndex}
        />
      ))}
      {scopedTableTabs.map((tab) => (
        <TableTabPanel
          key={tab.id}
          tab={tab}
          isPanelActive={isActive}
          isTableActive={isActive && isActiveTableItem(activeBottomPanelItem, tab.id)}
        />
      ))}
    </BottomPanelSlot>
  )
}
