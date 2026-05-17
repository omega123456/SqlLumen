import { useEffect, useMemo } from 'react'
import { useQueryStore } from '../../stores/query-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { ResultPanel } from './ResultPanel'
import { TableDataTab } from '../table-data/TableDataTab'
import type { TableDataTab as TableDataTabType } from '../../types/schema'
import styles from './QueryBottomPanel.module.css'

interface QueryBottomPanelProps {
  queryTabId: string
  connectionId: string
  isActive?: boolean
}

const DEFAULT_ACTIVE_BOTTOM_PANEL_ITEM = { type: 'result' } as const

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
  const setActiveBottomPanelItem = useQueryStore((state) => state.setActiveBottomPanelItem)
  const connectionTabs = useWorkspaceStore((state) => state.tabsByConnection[connectionId] ?? [])
  const scopedTableTabs = useMemo(
    () =>
      connectionTabs.filter(
        (tab): tab is TableDataTabType =>
          tab.type === 'table-data' && tab.parentQueryTabId === queryTabId
      ),
    [connectionTabs, queryTabId]
  )

  const activeTableTab = useMemo(
    () =>
      activeBottomPanelItem.type === 'table-data'
        ? (scopedTableTabs.find((tab) => tab.id === activeBottomPanelItem.tabId) ?? null)
        : null,
    [activeBottomPanelItem, scopedTableTabs]
  )

  useEffect(() => {
    if (activeBottomPanelItem.type !== 'table-data') return
    if (activeTableTab) return
    setActiveBottomPanelItem(queryTabId, { type: 'result' })
  }, [activeBottomPanelItem, activeTableTab, queryTabId, setActiveBottomPanelItem])

  return (
    <div className={styles.container} data-testid="query-bottom-panel">
      {results.map((_, resultIndex) => {
        const isResultActive =
          isActive && activeBottomPanelItem.type === 'result' && activeResultIndex === resultIndex

        return (
          <div
            key={`result-panel-${resultIndex}`}
            role="tabpanel"
            id={`result-tabpanel-${queryTabId}-${resultIndex}`}
            aria-labelledby={`result-${queryTabId}-${resultIndex}`}
            hidden={!isResultActive}
            className={styles.panel}
            data-testid={
              resultIndex === activeResultIndex
                ? 'query-bottom-panel-results'
                : `query-bottom-panel-result-${resultIndex}`
            }
          >
            {isResultActive && (
              <ResultPanel
                tabId={queryTabId}
                connectionId={connectionId}
                isActive={true}
                hideSubTabs
              />
            )}
          </div>
        )
      })}
      {scopedTableTabs.map((tab) => {
        const isTableActive =
          isActive &&
          activeBottomPanelItem.type === 'table-data' &&
          activeBottomPanelItem.tabId === tab.id
        return (
          <div
            key={tab.id}
            role="tabpanel"
            id={`table-data-tabpanel-${tab.id}`}
            aria-labelledby={`table-${tab.id}`}
            hidden={!isTableActive}
            className={styles.panel}
            data-testid={`query-bottom-panel-table-${tab.id}`}
          >
            {isActive && (
              <TableDataTab tab={tab} isActive={isTableActive} renderMode="bottom-panel" />
            )}
          </div>
        )
      })}
    </div>
  )
}
