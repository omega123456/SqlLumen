import { useWorkspaceStore } from '../stores/workspace-store'
import { useQueryStore } from '../stores/query-store'
import type { WorkspaceTab } from '../types/schema'

function isQueryEditorTabWithId(tab: WorkspaceTab, tabId: string | null): boolean {
  return tab.id === tabId && tab.type === 'query-editor'
}

export function insertSqlIntoEditor(connectionId: string, sqlText: string, label?: string): void {
  const { activeTabByConnection, tabsByConnection, openQueryTab } = useWorkspaceStore.getState()
  const activeTabId = activeTabByConnection[connectionId]
  const tabs = tabsByConnection[connectionId] ?? []
  const activeTab = tabs.find((tab) => isQueryEditorTabWithId(tab, activeTabId))

  if (activeTab && activeTabId) {
    const existing = useQueryStore.getState().tabs[activeTabId]?.content ?? ''
    const trimmedExisting = existing.replace(/\s+$/, '')
    const nextContent = trimmedExisting ? `${trimmedExisting}\n\n${sqlText}` : sqlText
    useQueryStore.getState().setContent(activeTabId, nextContent)
    return
  }
  const tabId = openQueryTab(connectionId, label ?? 'Query')
  if (tabId) {
    useQueryStore.getState().setContent(tabId, sqlText)
  }
}
