import type { ActiveBottomPanelItem, SingleResultState } from '../../../stores/query-store'
import type { TableDataTab } from '../../../types/schema'

export type BottomPanelTabItem =
  | { id: string; kind: 'result'; index: number; label: string; result: SingleResultState }
  | { id: string; kind: 'table-data'; tab: TableDataTab; label: string }

export function buildBottomPanelTabItems(
  queryTabId: string,
  results: SingleResultState[],
  tableDataTabs: TableDataTab[]
): BottomPanelTabItem[] {
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
}

export interface ActiveItemSelection {
  queryTabId: string
  activeBottomPanelItem: ActiveBottomPanelItem
  activeResultIndex: number
}

export function activeBottomPanelItemId({
  queryTabId,
  activeBottomPanelItem,
  activeResultIndex,
}: ActiveItemSelection): string {
  if (activeBottomPanelItem.type === 'table-data') {
    return `table-${activeBottomPanelItem.tabId}`
  }
  return `result-${queryTabId}-${activeResultIndex}`
}

export function showsResultSeparator(
  items: BottomPanelTabItem[],
  index: number,
  resultCount: number
): boolean {
  if (index === 0) return false
  const item = items[index]
  if (item.kind !== 'table-data') return false
  return items[index - 1]?.kind === 'result' && resultCount > 0
}
