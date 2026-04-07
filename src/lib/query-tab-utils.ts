import { useWorkspaceStore } from '../stores/workspace-store'
import { useQueryStore } from '../stores/query-store'

/**
 * Opens the active query-editor tab for the connection (if one exists) or
 * creates a new one, then pre-fills it with the given SQL text.
 */
export function insertSqlIntoEditor(connectionId: string, sqlText: string, label?: string): void {
  const { activeTabByConnection, tabsByConnection, openQueryTab } = useWorkspaceStore.getState()
  const activeTabId = activeTabByConnection[connectionId]
  const tabs = tabsByConnection[connectionId] ?? []
  const activeTab = tabs.find((t) => t.id === activeTabId && t.type === 'query-editor')

  if (activeTab && activeTabId) {
    useQueryStore.getState().setContent(activeTabId, sqlText)
  } else {
    const tabId = openQueryTab(connectionId, label ?? 'Query')
    if (tabId) {
      useQueryStore.getState().setContent(tabId, sqlText)
    }
  }
}
