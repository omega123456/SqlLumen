import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useWorkspaceStore,
  _resetTabIdCounter,
  _resetQueryTabCounter,
} from '../../stores/workspace-store'
import { useTableDataStore } from '../../stores/table-data-store'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import { useObjectEditorStore } from '../../stores/object-editor-store'
import type {
  TableDataTab,
  SchemaInfoTab,
  TableDesignerTab,
  ObjectEditorTab,
} from '../../types/schema'

beforeEach(() => {
  useWorkspaceStore.setState({
    tabsByConnection: {},
    activeTabByConnection: {},
  })
  useTableDataStore.setState({ tabs: {} })
  useTableDesignerStore.setState({ tabs: {} })
  useObjectEditorStore.setState({ tabs: {} })
  _resetTabIdCounter()
  _resetQueryTabCounter()
})

function makeTab(overrides: Partial<Omit<TableDataTab, 'id'>> = {}): Omit<TableDataTab, 'id'> {
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

function makeSchemaTab(
  overrides: Partial<Omit<SchemaInfoTab, 'id'>> = {}
): Omit<SchemaInfoTab, 'id'> {
  return {
    type: 'schema-info',
    label: 'users',
    connectionId: 'conn-1',
    databaseName: 'mydb',
    objectName: 'users',
    objectType: 'table',
    ...overrides,
  }
}

function makeDesignerTab(
  overrides: Partial<Omit<TableDesignerTab, 'id'>> = {}
): Omit<TableDesignerTab, 'id'> {
  return {
    type: 'table-designer',
    label: 'users',
    connectionId: 'conn-1',
    mode: 'alter',
    databaseName: 'mydb',
    objectName: 'users',
    ...overrides,
  }
}

function makeObjectEditorTab(
  overrides: Partial<Omit<ObjectEditorTab, 'id'>> = {}
): Omit<ObjectEditorTab, 'id'> {
  return {
    type: 'object-editor',
    label: 'Stored Procedure: my_proc',
    connectionId: 'conn-1',
    databaseName: 'mydb',
    objectName: 'my_proc',
    objectType: 'procedure',
    mode: 'alter',
    ...overrides,
  }
}

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

    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'orders', label: 'orders' }))
    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).not.toBe(firstTabId)

    useWorkspaceStore.getState().openTab(makeTab())

    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toHaveLength(2)
    expect(state.activeTabByConnection['conn-1']).toBe(firstTabId)
  })

  it('creates a new tab when same object but different type', () => {
    useWorkspaceStore.getState().openTab(makeTab({ type: 'table-data' }))
    useWorkspaceStore.getState().openTab(makeSchemaTab({ type: 'schema-info' }))

    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toHaveLength(2)
  })

  it('dedups table-designer tabs by object identity', () => {
    useWorkspaceStore.getState().openTab(makeDesignerTab())
    const firstId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    useWorkspaceStore.getState().openTab(makeDesignerTab())

    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toHaveLength(1)
    expect(state.activeTabByConnection['conn-1']).toBe(firstId)
  })
})

describe('useWorkspaceStore — openTab (object-editor)', () => {
  it('creates a new object-editor tab and sets it active', () => {
    useWorkspaceStore.getState().openTab(makeObjectEditorTab())

    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toHaveLength(1)
    const tab = state.tabsByConnection['conn-1'][0] as ObjectEditorTab
    expect(tab.type).toBe('object-editor')
    expect(tab.objectType).toBe('procedure')
    expect(tab.objectName).toBe('my_proc')
  })

  it('dedups object-editor tabs by connectionId + databaseName + objectName + type + objectType', () => {
    useWorkspaceStore.getState().openTab(makeObjectEditorTab())
    const firstId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    useWorkspaceStore.getState().openTab(makeObjectEditorTab())

    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toHaveLength(1)
    expect(state.activeTabByConnection['conn-1']).toBe(firstId)
  })

  it('allows two object-editor tabs for same-named objects of different types', () => {
    useWorkspaceStore.getState().openTab(
      makeObjectEditorTab({
        objectName: 'my_obj',
        objectType: 'procedure',
        label: 'Stored Procedure: my_obj',
      })
    )
    useWorkspaceStore.getState().openTab(
      makeObjectEditorTab({
        objectName: 'my_obj',
        objectType: 'function',
        label: 'Function: my_obj',
      })
    )

    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toHaveLength(2)
    expect((state.tabsByConnection['conn-1'][0] as ObjectEditorTab).objectType).toBe('procedure')
    expect((state.tabsByConnection['conn-1'][1] as ObjectEditorTab).objectType).toBe('function')
  })

  it('dedups create-mode tabs by placeholder name and objectType', () => {
    useWorkspaceStore.getState().openTab(
      makeObjectEditorTab({
        objectName: 'new_procedure',
        objectType: 'procedure',
        mode: 'create',
      })
    )
    const firstId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    useWorkspaceStore.getState().openTab(
      makeObjectEditorTab({
        objectName: 'new_procedure',
        objectType: 'procedure',
        mode: 'create',
      })
    )

    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toHaveLength(1)
    expect(state.activeTabByConnection['conn-1']).toBe(firstId)
  })
})

describe('useWorkspaceStore — openQueryTab', () => {
  it('creates a new query-editor tab with auto-incrementing label', () => {
    useWorkspaceStore.getState().openQueryTab('conn-1')
    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toHaveLength(1)
    expect(state.tabsByConnection['conn-1'][0].type).toBe('query-editor')
    expect(state.tabsByConnection['conn-1'][0].label).toBe('Query 1')
  })
})

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
    useWorkspaceStore.getState().closeTab('conn-1', tabs[2].id)

    const state = useWorkspaceStore.getState()
    expect(state.activeTabByConnection['conn-1']).toBe(tabs[1].id)
  })

  it('closeTab with dirty table-designer tab calls requestNavigationAction instead of closing', () => {
    useWorkspaceStore.getState().openTab(makeDesignerTab())
    const designerTabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id
    const requestNavigationAction = vi.spyOn(
      useTableDesignerStore.getState(),
      'requestNavigationAction'
    )

    useTableDesignerStore.getState().initTab(designerTabId, 'alter', 'conn-1', 'mydb', 'users')
    useTableDesignerStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        [designerTabId]: {
          ...state.tabs[designerTabId],
          isDirty: true,
        },
      },
    }))

    useWorkspaceStore.getState().closeTab('conn-1', designerTabId)

    expect(requestNavigationAction).toHaveBeenCalledTimes(1)
    expect(useWorkspaceStore.getState().tabsByConnection['conn-1']).toHaveLength(1)
  })

  it('closeTab with dirty object-editor tab calls requestNavigationAction instead of closing', () => {
    useWorkspaceStore.getState().openTab(makeObjectEditorTab())
    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id
    const requestNavigationAction = vi.spyOn(
      useObjectEditorStore.getState(),
      'requestNavigationAction'
    )

    useObjectEditorStore.setState({
      tabs: {
        [tabId]: {
          connectionId: 'conn-1',
          database: 'mydb',
          objectName: 'my_proc',
          objectType: 'procedure',
          mode: 'alter',
          content: 'modified',
          originalContent: 'original',
          isLoading: false,
          isSaving: false,
          error: null,
          pendingNavigationAction: null,
          savedObjectName: null,
        },
      },
    })

    useWorkspaceStore.getState().closeTab('conn-1', tabId)

    expect(requestNavigationAction).toHaveBeenCalledTimes(1)
    expect(useWorkspaceStore.getState().tabsByConnection['conn-1']).toHaveLength(1)
  })

  it('closeTab on clean object-editor tab closes immediately', () => {
    useWorkspaceStore.getState().openTab(makeObjectEditorTab())
    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id
    const cleanupSpy = vi.spyOn(useObjectEditorStore.getState(), 'cleanupTab')

    useObjectEditorStore.setState({
      tabs: {
        [tabId]: {
          connectionId: 'conn-1',
          database: 'mydb',
          objectName: 'my_proc',
          objectType: 'procedure',
          mode: 'alter',
          content: 'same',
          originalContent: 'same',
          isLoading: false,
          isSaving: false,
          error: null,
          pendingNavigationAction: null,
          savedObjectName: null,
        },
      },
    })

    useWorkspaceStore.getState().closeTab('conn-1', tabId)

    expect(cleanupSpy).toHaveBeenCalledWith(tabId)
    expect(useWorkspaceStore.getState().tabsByConnection['conn-1']).toHaveLength(0)
  })
})

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
    expect((state.tabsByConnection['conn-1'][0] as TableDataTab).databaseName).toBe('db2')
  })

  it('closes object-editor tabs for a database', () => {
    useWorkspaceStore
      .getState()
      .openTab(makeObjectEditorTab({ databaseName: 'db1', objectName: 'proc1' }))
    useWorkspaceStore
      .getState()
      .openTab(makeObjectEditorTab({ databaseName: 'db2', objectName: 'proc2' }))

    const cleanupSpy = vi.fn()
    const originalCleanup = useObjectEditorStore.getState().cleanupTab
    useObjectEditorStore.setState({
      cleanupTab: (...args: Parameters<typeof originalCleanup>) => {
        cleanupSpy(...args)
        originalCleanup(...args)
      },
    })

    useWorkspaceStore.getState().closeTabsByDatabase('conn-1', 'db1')

    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toHaveLength(1)
    expect((state.tabsByConnection['conn-1'][0] as ObjectEditorTab).databaseName).toBe('db2')
    expect(cleanupSpy).toHaveBeenCalledTimes(1)
  })
})

describe('useWorkspaceStore — closeTabsByObject', () => {
  it('closes tabs for a specific object', () => {
    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'users', label: 'users data' }))
    useWorkspaceStore
      .getState()
      .openTab(makeSchemaTab({ objectName: 'users', label: 'users info' }))
    useWorkspaceStore
      .getState()
      .openTab(makeDesignerTab({ objectName: 'users', label: 'users designer' }))
    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'orders', label: 'orders' }))

    useWorkspaceStore.getState().closeTabsByObject('conn-1', 'mydb', 'users')

    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toHaveLength(1)
    expect((state.tabsByConnection['conn-1'][0] as TableDataTab).objectName).toBe('orders')
  })

  it('closes object-editor tabs without objectType arg (backward compat)', () => {
    useWorkspaceStore.getState().openTab(
      makeObjectEditorTab({
        objectName: 'my_proc',
        objectType: 'procedure',
        label: 'Proc: my_proc',
      })
    )
    useWorkspaceStore.getState().openTab(
      makeObjectEditorTab({
        objectName: 'my_proc',
        objectType: 'function',
        label: 'Func: my_proc',
      })
    )
    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'orders', label: 'orders' }))

    useWorkspaceStore.getState().closeTabsByObject('conn-1', 'mydb', 'my_proc')

    const state = useWorkspaceStore.getState()
    // Both object-editor tabs should be closed
    expect(state.tabsByConnection['conn-1']).toHaveLength(1)
    expect((state.tabsByConnection['conn-1'][0] as TableDataTab).objectName).toBe('orders')
  })

  it("closeTabsByObject with objectType='procedure' does NOT close table-data tabs for same-named table", () => {
    // A table-data tab for a table named "orders"
    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'orders', label: 'orders data' }))
    // A table-designer tab for that same table
    useWorkspaceStore
      .getState()
      .openTab(makeDesignerTab({ objectName: 'orders', label: 'orders designer' }))
    // An object-editor tab for a procedure also named "orders"
    useWorkspaceStore.getState().openTab(
      makeObjectEditorTab({
        objectName: 'orders',
        objectType: 'procedure',
        label: 'Proc: orders',
      })
    )

    // Dropping the procedure named "orders" should NOT touch the table tabs
    useWorkspaceStore.getState().closeTabsByObject('conn-1', 'mydb', 'orders', 'procedure')

    const state = useWorkspaceStore.getState()
    // table-data and table-designer tabs should survive
    expect(state.tabsByConnection['conn-1']).toHaveLength(2)
    const types = state.tabsByConnection['conn-1'].map((t) => t.type)
    expect(types).toContain('table-data')
    expect(types).toContain('table-designer')
    // The procedure object-editor tab should be gone
    expect(types).not.toContain('object-editor')
  })

  it('closeTabsByObject with 4th objectType arg closes only matching-type object-editor tabs', () => {
    useWorkspaceStore.getState().openTab(
      makeObjectEditorTab({
        objectName: 'my_obj',
        objectType: 'procedure',
        label: 'Proc: my_obj',
      })
    )
    useWorkspaceStore.getState().openTab(
      makeObjectEditorTab({
        objectName: 'my_obj',
        objectType: 'function',
        label: 'Func: my_obj',
      })
    )

    useWorkspaceStore.getState().closeTabsByObject('conn-1', 'mydb', 'my_obj', 'procedure')

    const state = useWorkspaceStore.getState()
    expect(state.tabsByConnection['conn-1']).toHaveLength(1)
    expect((state.tabsByConnection['conn-1'][0] as ObjectEditorTab).objectType).toBe('function')
  })
})

describe('useWorkspaceStore — updateTabDatabase', () => {
  it('renames database in tab identifiers', () => {
    useWorkspaceStore.getState().openTab(makeTab({ databaseName: 'olddb', label: 'olddb.users' }))
    useWorkspaceStore.getState().updateTabDatabase('conn-1', 'olddb', 'newdb')

    const state = useWorkspaceStore.getState()
    const tabs = state.tabsByConnection['conn-1']
    expect((tabs[0] as TableDataTab).databaseName).toBe('newdb')
    expect(tabs[0].label).toBe('newdb.users')
  })
})

describe('useWorkspaceStore — updateTabObject', () => {
  it('renames object in tab identifiers', () => {
    useWorkspaceStore
      .getState()
      .openTab(makeTab({ objectName: 'old_table', label: 'mydb.old_table' }))
    useWorkspaceStore.getState().updateTabObject('conn-1', 'mydb', 'old_table', 'new_table')

    const state = useWorkspaceStore.getState()
    const tabs = state.tabsByConnection['conn-1']
    expect((tabs[0] as TableDataTab).objectName).toBe('new_table')
    expect(tabs[0].label).toBe('mydb.new_table')
  })
})

describe('useWorkspaceStore — updateTableDesignerTab', () => {
  it('updateTableDesignerTab updates mode and objectName on a table-designer tab', () => {
    useWorkspaceStore.getState().openTab(makeDesignerTab())
    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    useWorkspaceStore.getState().updateTableDesignerTab(tabId, {
      mode: 'create',
      objectName: 'accounts',
    })

    const tab = useWorkspaceStore.getState().tabsByConnection['conn-1'][0] as TableDesignerTab
    expect(tab.mode).toBe('create')
    expect(tab.objectName).toBe('accounts')
    expect(tab.label).toBe('accounts')
  })

  it('updateTableDesignerTab does not affect non-designer tabs', () => {
    useWorkspaceStore.getState().openTab(makeTab())
    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    useWorkspaceStore.getState().updateTableDesignerTab(tabId, {
      mode: 'create',
      objectName: 'accounts',
    })

    const tab = useWorkspaceStore.getState().tabsByConnection['conn-1'][0] as TableDataTab
    expect(tab.objectName).toBe('users')
    expect(tab.label).toBe('users')
  })
})

describe('useWorkspaceStore — updateObjectEditorTab', () => {
  it('updates objectName, mode, and label on an object-editor tab', () => {
    useWorkspaceStore.getState().openTab(makeObjectEditorTab())
    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    useWorkspaceStore.getState().updateObjectEditorTab(tabId, {
      objectName: 'renamed_proc',
      mode: 'alter',
      label: 'Stored Procedure: renamed_proc',
    })

    const tab = useWorkspaceStore.getState().tabsByConnection['conn-1'][0] as ObjectEditorTab
    expect(tab.objectName).toBe('renamed_proc')
    expect(tab.mode).toBe('alter')
    expect(tab.label).toBe('Stored Procedure: renamed_proc')
  })

  it('does not affect non-object-editor tabs', () => {
    useWorkspaceStore.getState().openTab(makeTab())
    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    useWorkspaceStore.getState().updateObjectEditorTab(tabId, {
      objectName: 'renamed',
      label: 'renamed',
    })

    const tab = useWorkspaceStore.getState().tabsByConnection['conn-1'][0] as TableDataTab
    expect(tab.objectName).toBe('users')
    expect(tab.label).toBe('users')
  })

  it('preserves existing label if no label in partial', () => {
    useWorkspaceStore.getState().openTab(makeObjectEditorTab())
    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    useWorkspaceStore.getState().updateObjectEditorTab(tabId, {
      mode: 'alter',
    })

    const tab = useWorkspaceStore.getState().tabsByConnection['conn-1'][0] as ObjectEditorTab
    expect(tab.mode).toBe('alter')
    expect(tab.label).toBe('Stored Procedure: my_proc')
  })
})

describe('useWorkspaceStore — forceCloseTab', () => {
  it('forceCloseTab calls tableDesignerStore.cleanupTab', () => {
    useWorkspaceStore.getState().openTab(makeDesignerTab())
    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id
    const cleanupSpy = vi.spyOn(useTableDesignerStore.getState(), 'cleanupTab')

    useWorkspaceStore.getState().forceCloseTab('conn-1', tabId)

    expect(cleanupSpy).toHaveBeenCalledWith(tabId)
  })

  it('forceCloseTab calls objectEditorStore.cleanupTab for object-editor tabs', () => {
    useWorkspaceStore.getState().openTab(makeObjectEditorTab())
    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id
    const cleanupSpy = vi.spyOn(useObjectEditorStore.getState(), 'cleanupTab')

    useWorkspaceStore.getState().forceCloseTab('conn-1', tabId)

    expect(cleanupSpy).toHaveBeenCalledWith(tabId)
    expect(useWorkspaceStore.getState().tabsByConnection['conn-1']).toHaveLength(0)
  })
})

describe('useWorkspaceStore — clearConnectionTabs', () => {
  it('clearConnectionTabs calls tableDesignerStore.cleanupTab for designer tabs', () => {
    useWorkspaceStore.getState().openTab(makeDesignerTab())
    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id
    const cleanupSpy = vi.spyOn(useTableDesignerStore.getState(), 'cleanupTab')

    useWorkspaceStore.getState().clearConnectionTabs('conn-1')

    expect(cleanupSpy).toHaveBeenCalledWith(tabId)
  })

  it('clearConnectionTabs calls objectEditorStore.cleanupTab for object-editor tabs', () => {
    useWorkspaceStore.getState().openTab(makeObjectEditorTab())
    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id
    const cleanupSpy = vi.spyOn(useObjectEditorStore.getState(), 'cleanupTab')

    useWorkspaceStore.getState().clearConnectionTabs('conn-1')

    expect(cleanupSpy).toHaveBeenCalledWith(tabId)
    expect(useWorkspaceStore.getState().tabsByConnection['conn-1']).toBeUndefined()
  })
})
