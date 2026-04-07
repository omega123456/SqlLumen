import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { insertSqlIntoEditor } from '../../lib/query-tab-utils'
import {
  useWorkspaceStore,
  _resetTabIdCounter,
  _resetQueryTabCounter,
} from '../../stores/workspace-store'
import { useQueryStore } from '../../stores/query-store'

beforeEach(() => {
  useWorkspaceStore.setState({
    tabsByConnection: {},
    activeTabByConnection: {},
  })
  useQueryStore.setState({ tabs: {} })
  _resetTabIdCounter()
  _resetQueryTabCounter()
  vi.clearAllMocks()

  mockIPC((cmd) => {
    switch (cmd) {
      case 'log_frontend':
        return undefined
      default:
        return null
    }
  })
})

describe('insertSqlIntoEditor', () => {
  it('creates a new query tab when no active tab exists', () => {
    insertSqlIntoEditor('conn-1', 'SELECT 1', 'Test Query')

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(tabs).toHaveLength(1)
    expect(tabs[0].type).toBe('query-editor')
    expect(tabs[0].label).toBe('Test Query')

    const queryTab = useQueryStore.getState().tabs[tabs[0].id]
    expect(queryTab?.content).toBe('SELECT 1')
  })

  it('reuses active query-editor tab when one exists', () => {
    // Create a query tab first
    insertSqlIntoEditor('conn-1', 'SELECT 1', 'First')

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const firstTabId = tabs[0].id

    // Now insert again — should reuse the active tab
    insertSqlIntoEditor('conn-1', 'SELECT 2', 'Second')

    // Still only one tab
    const updatedTabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(updatedTabs).toHaveLength(1)

    // Content updated
    const queryTab = useQueryStore.getState().tabs[firstTabId]
    expect(queryTab?.content).toBe('SELECT 2')
  })

  it('uses default label "Query" when no label is provided', () => {
    insertSqlIntoEditor('conn-1', 'SELECT 1')

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(tabs).toHaveLength(1)
    expect(tabs[0].label).toBe('Query')
  })

  it('creates new tab when active tab is not a query-editor', () => {
    // Manually set up a non-query tab as active
    useWorkspaceStore.setState({
      tabsByConnection: {
        'conn-1': [{ id: 'tab-1', type: 'history', label: 'History', connectionId: 'conn-1' }],
      },
      activeTabByConnection: { 'conn-1': 'tab-1' },
    })

    insertSqlIntoEditor('conn-1', 'SELECT 1', 'New Query')

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    // Should have 2 tabs: the history tab and the new query tab
    expect(tabs).toHaveLength(2)
    const queryTab = tabs.find((t) => t.type === 'query-editor')
    expect(queryTab).toBeDefined()
    expect(queryTab!.label).toBe('New Query')
  })
})
