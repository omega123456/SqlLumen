import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useWorkspaceStore,
  _resetTabIdCounter,
  _resetQueryTabCounter,
} from '../../stores/workspace-store'
import { useTableDataStore } from '../../stores/table-data-store'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import { useObjectEditorStore } from '../../stores/object-editor-store'
import { useQueryStore, DEFAULT_RESULT_STATE } from '../../stores/query-store'
import { useAiStore } from '../../stores/ai-store'
import { mockIPC } from '@tauri-apps/api/mocks'
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
  useAiStore.setState({ tabs: {} })
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

// ---------------------------------------------------------------------------
// Close-tab guard: query-editor with dirty non-active results
// ---------------------------------------------------------------------------

describe('useWorkspaceStore — closeTab query-editor with dirty non-active result', () => {
  beforeEach(() => {
    mockIPC((cmd) => {
      if (cmd === 'evict_results') return null
      return null
    })
  })

  it('switches to dirty result and sets pendingNavigationAction when dirty result is non-active', () => {
    // Open a query-editor tab
    const tabId = useWorkspaceStore.getState().openQueryTab('conn-1')

    // Set up query store with a dirty non-active result (index 1 is dirty, active is 0)
    useQueryStore.setState({
      tabs: {
        [tabId]: {
          content: 'SELECT 1; SELECT 2',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q1',
            },
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q2',
              editState: {
                rowKey: { id: 1 },
                originalValues: { name: 'Alice' },
                currentValues: { name: 'Bob' },
                modifiedColumns: new Set(['name']),
                isNewRow: false,
              },
              editingRowIndex: 0,
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })

    // Try to close the tab
    useWorkspaceStore.getState().closeTab('conn-1', tabId)

    // Tab should NOT have been closed — it should still exist with pendingClose
    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(tabs).toHaveLength(1)
    expect(tabs[0].id).toBe(tabId)

    // The query store should have switched activeResultIndex to the dirty result
    const queryTab = useQueryStore.getState().tabs[tabId]
    expect(queryTab?.activeResultIndex).toBe(1)

    // The query store should have a pendingNavigationAction set
    expect(queryTab?.pendingNavigationAction).not.toBeNull()
  })

  it('uses requestNavigationAction when dirty result IS the active result', () => {
    // Open a query-editor tab
    const tabId = useWorkspaceStore.getState().openQueryTab('conn-1')

    // Set up query store with a dirty ACTIVE result (index 0 is dirty and active)
    useQueryStore.setState({
      tabs: {
        [tabId]: {
          content: 'SELECT 1; SELECT 2',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q1',
              editState: {
                rowKey: { id: 1 },
                originalValues: { name: 'Alice' },
                currentValues: { name: 'Bob' },
                modifiedColumns: new Set(['name']),
                isNewRow: false,
              },
              editingRowIndex: 0,
            },
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q2',
            },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })

    // Try to close the tab
    useWorkspaceStore.getState().closeTab('conn-1', tabId)

    // Tab should NOT have been closed
    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(tabs).toHaveLength(1)

    // requestNavigationAction should have set the pending action
    const queryTab = useQueryStore.getState().tabs[tabId]
    expect(queryTab?.pendingNavigationAction).not.toBeNull()
  })

  it('loops through multiple dirty results before closing (resolve first → check next)', () => {
    const tabId = useWorkspaceStore.getState().openQueryTab('conn-1')

    // Two dirty results: index 0 and index 2
    useQueryStore.setState({
      tabs: {
        [tabId]: {
          content: 'SELECT 1; SELECT 2; SELECT 3',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q1',
              editState: {
                rowKey: { id: 1 },
                originalValues: { name: 'Alice' },
                currentValues: { name: 'Modified1' },
                modifiedColumns: new Set(['name']),
                isNewRow: false,
              },
              editingRowIndex: 0,
            },
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q2',
            },
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q3',
              editState: {
                rowKey: { id: 2 },
                originalValues: { email: 'a@b.com' },
                currentValues: { email: 'x@y.com' },
                modifiedColumns: new Set(['email']),
                isNewRow: false,
              },
              editingRowIndex: 0,
            },
          ],
          activeResultIndex: 1, // active is the clean one
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })

    // Trigger close
    useWorkspaceStore.getState().closeTab('conn-1', tabId)

    // Tab should still be open
    expect(useWorkspaceStore.getState().tabsByConnection['conn-1']).toHaveLength(1)

    // Should have switched to first dirty result (index 0) and set pendingNavigationAction
    let queryTab = useQueryStore.getState().tabs[tabId]
    expect(queryTab?.activeResultIndex).toBe(0)
    expect(queryTab?.pendingNavigationAction).not.toBeNull()

    // Simulate user discarding result 0 (clears its editState and calls pendingNavigationAction)
    useQueryStore.getState().discardCurrentRow(tabId)
    // Fire the pending action (simulates what confirmNavigation does)
    const firstAction = useQueryStore.getState().tabs[tabId]?.pendingNavigationAction
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        [tabId]: { ...prev.tabs[tabId], pendingNavigationAction: null },
      },
    }))
    firstAction?.()

    // Now the loop should have found result 2 as the next dirty result
    queryTab = useQueryStore.getState().tabs[tabId]
    // Tab should STILL be open (result 2 is still dirty)
    expect(useWorkspaceStore.getState().tabsByConnection['conn-1']).toHaveLength(1)
    expect(queryTab?.activeResultIndex).toBe(2)
    expect(queryTab?.pendingNavigationAction).not.toBeNull()

    // Simulate user discarding result 2
    useQueryStore.getState().discardCurrentRow(tabId)
    const secondAction = useQueryStore.getState().tabs[tabId]?.pendingNavigationAction
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        [tabId]: { ...prev.tabs[tabId], pendingNavigationAction: null },
      },
    }))
    secondAction?.()

    // Now all results are clean — tab should be closed
    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1'] ?? []
    expect(tabs).toHaveLength(0)
  })

  it('closes query-editor tab normally when no results are dirty', () => {
    const tabId = useWorkspaceStore.getState().openQueryTab('conn-1')

    // Set up query store with clean results
    useQueryStore.setState({
      tabs: {
        [tabId]: {
          content: 'SELECT 1; SELECT 2',
          filePath: null,
          tabStatus: 'success',
          prevTabStatus: 'idle',
          cursorPosition: null,
          connectionId: 'conn-1',
          results: [
            { ...DEFAULT_RESULT_STATE, resultStatus: 'success', queryId: 'q1' },
            { ...DEFAULT_RESULT_STATE, resultStatus: 'success', queryId: 'q2' },
          ],
          activeResultIndex: 0,
          pendingNavigationAction: null,
          executionStartedAt: null,
          isCancelling: false,
          wasCancelled: false,
        },
      },
    })

    useWorkspaceStore.getState().closeTab('conn-1', tabId)

    // Tab should have been closed
    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1'] ?? []
    expect(tabs).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// AI store cleanup integration
// ---------------------------------------------------------------------------

describe('useWorkspaceStore — AI store cleanup', () => {
  beforeEach(() => {
    mockIPC((cmd) => {
      if (cmd === 'evict_results') return null
      return null
    })
  })

  it('closeTab on query-editor tab cleans up AI store state', () => {
    const tabId = useWorkspaceStore.getState().openQueryTab('conn-1')

    // Set up AI state for the tab
    useAiStore.setState({
      tabs: {
        [tabId]: {
          messages: [{ id: '1', role: 'user', content: 'hello', timestamp: 1 }],
          isGenerating: false,
          activeStreamId: null,
          attachedContext: null,
          isPanelOpen: true,
          error: null,
          retrievedSchemaDdl: '',
          lastRetrievalTimestamp: 0,
          isWaitingForIndex: false,
          connectionId: null,
          _unlisten: null,
        },
      },
    })

    useWorkspaceStore.getState().closeTab('conn-1', tabId)

    // AI state should be cleaned up
    expect(useAiStore.getState().tabs[tabId]).toBeUndefined()
  })

  it('forceCloseTab cleans up AI store state', () => {
    const tabId = useWorkspaceStore.getState().openQueryTab('conn-1')

    useAiStore.setState({
      tabs: {
        [tabId]: {
          messages: [],
          isGenerating: false,
          activeStreamId: null,
          attachedContext: null,
          isPanelOpen: false,
          error: null,
          retrievedSchemaDdl: '',
          lastRetrievalTimestamp: 0,
          isWaitingForIndex: false,
          connectionId: null,
          _unlisten: null,
        },
      },
    })

    useWorkspaceStore.getState().forceCloseTab('conn-1', tabId)

    expect(useAiStore.getState().tabs[tabId]).toBeUndefined()
  })

  it('clearConnectionTabs cleans up AI store state for all tabs', () => {
    const tabId1 = useWorkspaceStore.getState().openQueryTab('conn-1')
    const tabId2 = useWorkspaceStore.getState().openQueryTab('conn-1')

    useAiStore.setState({
      tabs: {
        [tabId1]: {
          messages: [],
          isGenerating: false,
          activeStreamId: null,
          attachedContext: null,
          isPanelOpen: true,
          error: null,
          retrievedSchemaDdl: '',
          lastRetrievalTimestamp: 0,
          isWaitingForIndex: false,
          connectionId: null,
          _unlisten: null,
        },
        [tabId2]: {
          messages: [],
          isGenerating: false,
          activeStreamId: null,
          attachedContext: null,
          isPanelOpen: false,
          error: null,
          retrievedSchemaDdl: '',
          lastRetrievalTimestamp: 0,
          isWaitingForIndex: false,
          connectionId: null,
          _unlisten: null,
        },
      },
    })

    useWorkspaceStore.getState().clearConnectionTabs('conn-1')

    expect(useAiStore.getState().tabs[tabId1]).toBeUndefined()
    expect(useAiStore.getState().tabs[tabId2]).toBeUndefined()
  })

  it('closeTabsByDatabase cleans up AI store state for affected tabs', () => {
    useWorkspaceStore
      .getState()
      .openTab(makeTab({ databaseName: 'db1', objectName: 'a', label: 'a' }))
    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    useAiStore.setState({
      tabs: {
        [tabId]: {
          messages: [],
          isGenerating: false,
          activeStreamId: null,
          attachedContext: null,
          isPanelOpen: false,
          error: null,
          retrievedSchemaDdl: '',
          lastRetrievalTimestamp: 0,
          isWaitingForIndex: false,
          connectionId: null,
          _unlisten: null,
        },
      },
    })

    useWorkspaceStore.getState().closeTabsByDatabase('conn-1', 'db1')

    expect(useAiStore.getState().tabs[tabId]).toBeUndefined()
  })

  it('closeTabsByObject cleans up AI store state for affected tabs', () => {
    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'users', label: 'users data' }))
    const tabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    useAiStore.setState({
      tabs: {
        [tabId]: {
          messages: [],
          isGenerating: false,
          activeStreamId: null,
          attachedContext: null,
          isPanelOpen: false,
          error: null,
          retrievedSchemaDdl: '',
          lastRetrievalTimestamp: 0,
          isWaitingForIndex: false,
          connectionId: null,
          _unlisten: null,
        },
      },
    })

    useWorkspaceStore.getState().closeTabsByObject('conn-1', 'mydb', 'users')

    expect(useAiStore.getState().tabs[tabId]).toBeUndefined()
  })
})
