import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkspaceStore, _resetTabIdCounter } from '../../stores/workspace-store'
import type { WorkspaceTab } from '../../types/schema'

beforeEach(() => {
  useWorkspaceStore.setState({
    tabsByConnection: {},
    activeTabByConnection: {},
  })
  _resetTabIdCounter()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTab(overrides: Partial<Omit<WorkspaceTab, 'id'>> = {}): Omit<WorkspaceTab, 'id'> {
  return {
    type: 'table-data',
    label: 'users',
    connectionId: 'conn-1',
    databaseName: 'mydb',
    objectName: 'users',
    objectType: 'table',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// openTab
// ---------------------------------------------------------------------------

describe('useWorkspaceStore — openTab', () => {
  it('creates a new tab and sets it active', () => {
    useWorkspaceStore.getState().openTab(makeTab())

    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toHaveLength(1)
    expect(state.tabsByConnection['conn-1'][0].label).toBe('users')
    expect(state.activeTabByConnection['conn-1']).toBe(state.tabsByConnection['conn-1'][0].id)
  })

  it('focuses existing tab when same connectionId + database + object + type (dedup)', () => {
    useWorkspaceStore.getState().openTab(makeTab())
    const firstTabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    // Open another tab to change active
    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'orders', label: 'orders' }))
    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).not.toBe(firstTabId)

    // Re-open the first tab — should focus, not create new
    useWorkspaceStore.getState().openTab(makeTab())

    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toHaveLength(2) // still 2, not 3
    expect(state.activeTabByConnection['conn-1']).toBe(firstTabId)
  })

  it('creates a new tab when same object but different type', () => {
    useWorkspaceStore.getState().openTab(makeTab({ type: 'table-data' }))
    useWorkspaceStore.getState().openTab(makeTab({ type: 'schema-info' }))

    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toHaveLength(2)
  })

  it('creates separate tabs for different connections', () => {
    useWorkspaceStore.getState().openTab(makeTab({ connectionId: 'conn-1' }))
    useWorkspaceStore.getState().openTab(makeTab({ connectionId: 'conn-2' }))

    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toHaveLength(1)
    expect(state.tabsByConnection['conn-2']).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// closeTab
// ---------------------------------------------------------------------------

describe('useWorkspaceStore — closeTab', () => {
  it('removes the tab', () => {
    useWorkspaceStore.getState().openTab(makeTab())
    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    useWorkspaceStore.getState().closeTab('conn-1', tabId)

    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toHaveLength(0)
    expect(state.activeTabByConnection['conn-1']).toBeNull()
  })

  it('activates adjacent tab when closing active tab', () => {
    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'a', label: 'a' }))
    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'b', label: 'b' }))
    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'c', label: 'c' }))

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const activeId = useWorkspaceStore.getState().activeTabByConnection['conn-1']
    expect(activeId).toBe(tabs[2].id) // last opened is active

    useWorkspaceStore.getState().closeTab('conn-1', tabs[2].id)

    // Should activate the previous tab
    const state = useWorkspaceStore.getState()
    expect(state.activeTabByConnection['conn-1']).toBe(tabs[1].id)
  })

  it('does nothing for unknown tabId', () => {
    useWorkspaceStore.getState().openTab(makeTab())
    useWorkspaceStore.getState().closeTab('conn-1', 'unknown-id')

    expect(useWorkspaceStore.getState().tabsByConnection['conn-1']).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// setActiveTab
// ---------------------------------------------------------------------------

describe('useWorkspaceStore — setActiveTab', () => {
  it('switches active tab', () => {
    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'a', label: 'a' }))
    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'b', label: 'b' }))

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    useWorkspaceStore.getState().setActiveTab('conn-1', tabs[0].id)

    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(tabs[0].id)
  })
})

// ---------------------------------------------------------------------------
// closeTabsByDatabase
// ---------------------------------------------------------------------------

describe('useWorkspaceStore — closeTabsByDatabase', () => {
  it('closes all tabs for a database', () => {
    useWorkspaceStore
      .getState()
      .openTab(makeTab({ databaseName: 'db1', objectName: 'a', label: 'a' }))
    useWorkspaceStore
      .getState()
      .openTab(makeTab({ databaseName: 'db1', objectName: 'b', label: 'b' }))
    useWorkspaceStore
      .getState()
      .openTab(makeTab({ databaseName: 'db2', objectName: 'c', label: 'c' }))

    useWorkspaceStore.getState().closeTabsByDatabase('conn-1', 'db1')

    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toHaveLength(1)
    expect(state.tabsByConnection['conn-1'][0].databaseName).toBe('db2')
  })

  it('updates active tab when closing database tabs', () => {
    useWorkspaceStore
      .getState()
      .openTab(makeTab({ databaseName: 'db1', objectName: 'a', label: 'a' }))
    useWorkspaceStore
      .getState()
      .openTab(makeTab({ databaseName: 'db2', objectName: 'b', label: 'b' }))

    // Active is db2.b
    useWorkspaceStore.getState().closeTabsByDatabase('conn-1', 'db2')

    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toHaveLength(1)
    // Should switch to remaining tab
    expect(state.activeTabByConnection['conn-1']).toBe(state.tabsByConnection['conn-1'][0].id)
  })
})

// ---------------------------------------------------------------------------
// closeTabsByObject
// ---------------------------------------------------------------------------

describe('useWorkspaceStore — closeTabsByObject', () => {
  it('closes tabs for a specific object', () => {
    useWorkspaceStore
      .getState()
      .openTab(makeTab({ type: 'table-data', objectName: 'users', label: 'users data' }))
    useWorkspaceStore
      .getState()
      .openTab(makeTab({ type: 'schema-info', objectName: 'users', label: 'users info' }))
    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'orders', label: 'orders' }))

    useWorkspaceStore.getState().closeTabsByObject('conn-1', 'mydb', 'users')

    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toHaveLength(1)
    expect(state.tabsByConnection['conn-1'][0].objectName).toBe('orders')
  })
})

// ---------------------------------------------------------------------------
// updateTabDatabase
// ---------------------------------------------------------------------------

describe('useWorkspaceStore — updateTabDatabase', () => {
  it('renames database in tab identifiers', () => {
    useWorkspaceStore.getState().openTab(makeTab({ databaseName: 'olddb', label: 'olddb.users' }))
    useWorkspaceStore
      .getState()
      .openTab(makeTab({ databaseName: 'otherdb', objectName: 'orders', label: 'otherdb.orders' }))

    useWorkspaceStore.getState().updateTabDatabase('conn-1', 'olddb', 'newdb')

    const state = useWorkspaceStore.getState()
    const tabs = state.tabsByConnection['conn-1']
    expect(tabs[0].databaseName).toBe('newdb')
    expect(tabs[0].label).toBe('newdb.users')
    // Other tab unchanged
    expect(tabs[1].databaseName).toBe('otherdb')
  })
})

// ---------------------------------------------------------------------------
// updateTabObject
// ---------------------------------------------------------------------------

describe('useWorkspaceStore — updateTabObject', () => {
  it('renames object in tab identifiers', () => {
    useWorkspaceStore
      .getState()
      .openTab(makeTab({ objectName: 'old_table', label: 'mydb.old_table' }))
    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'other', label: 'mydb.other' }))

    useWorkspaceStore.getState().updateTabObject('conn-1', 'mydb', 'old_table', 'new_table')

    const state = useWorkspaceStore.getState()
    const tabs = state.tabsByConnection['conn-1']
    expect(tabs[0].objectName).toBe('new_table')
    expect(tabs[0].label).toBe('mydb.new_table')
    // Other tab unchanged
    expect(tabs[1].objectName).toBe('other')
  })
})

// ---------------------------------------------------------------------------
// setSubTab
// ---------------------------------------------------------------------------

describe('useWorkspaceStore — setSubTab', () => {
  it('sets active sub-tab on a schema-info tab', () => {
    useWorkspaceStore.getState().openTab(makeTab({ type: 'schema-info' }))
    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    useWorkspaceStore.getState().setSubTab('conn-1', tabId, 'indexes')

    const tab = useWorkspaceStore.getState().tabsByConnection['conn-1'][0]
    expect(tab.subTabId).toBe('indexes')
  })

  it('can change sub-tab multiple times', () => {
    useWorkspaceStore.getState().openTab(makeTab({ type: 'schema-info' }))
    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    useWorkspaceStore.getState().setSubTab('conn-1', tabId, 'columns')
    useWorkspaceStore.getState().setSubTab('conn-1', tabId, 'ddl')

    const tab = useWorkspaceStore.getState().tabsByConnection['conn-1'][0]
    expect(tab.subTabId).toBe('ddl')
  })
})

// ---------------------------------------------------------------------------
// clearConnectionTabs
// ---------------------------------------------------------------------------

describe('useWorkspaceStore — clearConnectionTabs', () => {
  it('clears all tabs for a connection', () => {
    useWorkspaceStore.getState().openTab(makeTab({ connectionId: 'conn-1' }))
    useWorkspaceStore
      .getState()
      .openTab(makeTab({ connectionId: 'conn-2', objectName: 'b', label: 'b' }))

    useWorkspaceStore.getState().clearConnectionTabs('conn-1')

    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toBeUndefined()
    expect(state.activeTabByConnection['conn-1']).toBeUndefined()
    // conn-2 unaffected
    expect(state.tabsByConnection['conn-2']).toHaveLength(1)
  })
})
