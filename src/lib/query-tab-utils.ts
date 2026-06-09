import { useWorkspaceStore } from '../stores/workspace-store'
import { useQueryStore } from '../stores/query-store'

/**
 * Inserts the given SQL into the connection's active query-editor tab,
 * appending to any existing content (separated by a blank line). When no
 * active query-editor tab exists, a new one is created with the SQL.
 */
export function insertSqlIntoEditor(connectionId: string, sqlText: string, label?: string): void {
  const { activeTabByConnection, tabsByConnection, openQueryTab } = useWorkspaceStore.getState()
  const activeTabId = activeTabByConnection[connectionId]
  const tabs = tabsByConnection[connectionId] ?? []
  const activeTab = tabs.find((t) => t.id === activeTabId && t.type === 'query-editor')

  if (activeTab && activeTabId) {
    const existing = useQueryStore.getState().tabs[activeTabId]?.content ?? ''
    const trimmedExisting = existing.replace(/\s+$/, '')
    const nextContent = trimmedExisting ? `${trimmedExisting}\n\n${sqlText}` : sqlText
    useQueryStore.getState().setContent(activeTabId, nextContent)
  } else {
    const tabId = openQueryTab(connectionId, label ?? 'Query')
    if (tabId) {
      useQueryStore.getState().setContent(tabId, sqlText)
    }
  }
}
