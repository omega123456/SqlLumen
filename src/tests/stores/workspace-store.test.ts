import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { resetWorkspaceStore, seedVisibleConnection } from '../helpers/workspace-test-utils'
import { useTableDataStore } from '../../stores/table-data-store'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import { useObjectEditorStore } from '../../stores/object-editor-store'
import { useQueryStore, DEFAULT_RESULT_STATE, type TabQueryState } from '../../stores/query-store'
import { useAiStore } from '../../stores/ai-store'
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../stores/settings-store'
import { makeAiTabState } from '../helpers/ai-test-utils'
import { makeTableDataTabState } from '../helpers/table-data-test-utils'
import { ipc } from '../ipc-mock'
import type {
  TableDataTab,
  SchemaInfoTab,
  TableDesignerTab,
  ObjectEditorTab,
} from '../../types/schema'

beforeEach(() => {
  resetWorkspaceStore({ visibleConnectionSessionId: 'conn-1' })
  useTableDataStore.setState({ tabs: {} })
  useTableDesignerStore.setState({ tabs: {} })
  useObjectEditorStore.setState({ tabs: {} })
  useAiStore.setState({ tabs: {} })
  useSettingsStore.setState({
    settings: { ...SETTINGS_DEFAULTS, 'results.tableTabsInBottomPanel': 'false' },
    pendingChanges: {},
    isLoading: false,
    isDirty: false,
    activeSection: 'general',
    isDialogOpen: false,
    dialogSection: undefined,
  })
})

function setBottomPanelEnabled(enabled: boolean) {
  useSettingsStore.setState((state) => ({
    ...state,
    settings: {
      ...state.settings,
      'results.tableTabsInBottomPanel': enabled ? 'true' : 'false',
    },
  }))
}

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

function makeQueryTabState(overrides: Partial<TabQueryState> = {}): TabQueryState {
  return {
    content: 'SELECT * FROM users',
    selectedText: '',
    filePath: null,
    tabStatus: 'success',
    prevTabStatus: 'idle',
    cursorPosition: null,
    connectionId: 'conn-1',
    results: [
      {
        ...DEFAULT_RESULT_STATE,
        resultStatus: 'success',
        queryId: 'q-validate-1',
      },
    ],
    activeResultIndex: 0,
    activeBottomPanelItem: { type: 'result' as const },
    pendingNavigationAction: null,
    executionStartedAt: null,
    isCancelling: false,
    wasCancelled: false,
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

  it('scopes table-data tabs to the active query tab when the setting is enabled', () => {
    setBottomPanelEnabled(true)
    const queryTabId = useWorkspaceStore.getState().openQueryTab('conn-1')

    useWorkspaceStore.getState().openTab(makeTab())

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const tableTab = tabs.find((tab) => tab.type === 'table-data')
    expect(tableTab).toMatchObject({ type: 'table-data', parentQueryTabId: queryTabId })
    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(queryTabId)
    expect(useQueryStore.getState().getTabState(queryTabId).activeBottomPanelItem).toEqual({
      type: 'table-data',
      tabId: tableTab?.id,
    })
  })

  it('auto-creates a query tab when opening scoped table data without an active query tab', () => {
    setBottomPanelEnabled(true)

    useWorkspaceStore.getState().openTab(makeTab())

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const queryTab = tabs.find((tab) => tab.type === 'query-editor')
    const tableTab = tabs.find((tab) => tab.type === 'table-data')
    expect(queryTab).toBeDefined()
    expect(tableTab).toMatchObject({ type: 'table-data', parentQueryTabId: queryTab?.id })
    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(queryTab?.id)
  })

  it('allows the same table in different query scopes', () => {
    setBottomPanelEnabled(true)
    const queryTabOne = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')
    useWorkspaceStore.getState().openTab(makeTab())

    const queryTabTwo = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 2')
    useWorkspaceStore.getState().openTab(makeTab())

    const tableTabs = useWorkspaceStore
      .getState()
      .tabsByConnection['conn-1'].filter((tab): tab is TableDataTab => tab.type === 'table-data')

    expect(tableTabs).toHaveLength(2)
    expect(tableTabs.map((tab) => tab.parentQueryTabId)).toEqual([queryTabOne, queryTabTwo])
  })

  it('normalizes existing scoped table-data tabs back to standalone when the setting is disabled', () => {
    setBottomPanelEnabled(true)
    const queryTabId = useWorkspaceStore.getState().openQueryTab('conn-1')
    useWorkspaceStore.getState().openTab(makeTab())

    setBottomPanelEnabled(false)
    useWorkspaceStore
      .getState()
      .openTab(makeSchemaTab({ objectName: 'orders', label: 'orders', type: 'schema-info' }))

    const tableTab = useWorkspaceStore
      .getState()
      .tabsByConnection['conn-1'].find((tab): tab is TableDataTab => tab.type === 'table-data')
    expect(queryTabId).toBeTruthy()
    expect(tableTab?.parentQueryTabId).toBeUndefined()
  })

  it('deduplicates identical standalone table-data tabs while normalizing scoped tabs', () => {
    useWorkspaceStore.getState().openTab(makeTab())
    const standaloneTabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    setBottomPanelEnabled(true)
    const queryTabId = useWorkspaceStore.getState().openQueryTab('conn-1')
    useWorkspaceStore.getState().openTab(makeTab())
    useQueryStore.getState().setActiveBottomPanelItem(queryTabId, {
      type: 'table-data',
      tabId: useWorkspaceStore
        .getState()
        .tabsByConnection[
          'conn-1'
        ].find((tab) => tab.type === 'table-data' && tab.parentQueryTabId === queryTabId)!.id,
    })

    useWorkspaceStore.getState().normalizeTableDataTabScopes()

    const tableTabs = useWorkspaceStore
      .getState()
      .tabsByConnection['conn-1'].filter((tab): tab is TableDataTab => tab.type === 'table-data')

    expect(tableTabs).toHaveLength(1)
    expect(tableTabs[0].id).toBe(standaloneTabId)
    expect(tableTabs[0].parentQueryTabId).toBeUndefined()
    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(standaloneTabId)
  })
})

describe('useWorkspaceStore — query result validation on activation', () => {
  it('touches active query results when a query tab becomes active', () => {
    useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')
    const queryTab = useWorkspaceStore.getState().tabsByConnection['conn-1'][0]

    useQueryStore.setState({
      tabs: {
        [queryTab.id]: makeQueryTabState(),
      },
    })

    useWorkspaceStore.getState().setActiveTab('conn-1', queryTab.id)

    expect(ipc.calls('touch_results')).toHaveLength(1)
    expect(ipc.calls('touch_results')[0]).toMatchObject({
      connectionId: 'conn-1',
      tabId: queryTab.id,
    })
  })
})

describe('useWorkspaceStore — visible surface activation lifecycle', () => {
  it('marks the previously visible query result inactive when opening a new query tab', async () => {
    const firstQueryTabId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')
    useQueryStore.setState({
      tabs: {
        [firstQueryTabId]: makeQueryTabState({
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'query-1',
              rows: [[1, 'alice']],
              rowResidency: {
                status: 'resident',
                isActive: true,
                inactiveSince: null,
              },
            },
          ],
        }),
      },
    })

    const secondQueryTabId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 2')

    await vi.waitFor(() => {
      expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(secondQueryTabId)
      expect(useQueryStore.getState().tabs[firstQueryTabId]!.results[0]!.rowResidency).toEqual({
        status: 'resident',
        isActive: false,
        inactiveSince: expect.any(Number),
      })
    })
  })

  it('marks a deduped standalone table-data surface active when openTab focuses it', async () => {
    useWorkspaceStore.getState().openTab(makeTab())
    useWorkspaceStore.getState().openTab(makeSchemaTab({ objectName: 'orders', label: 'orders' }))

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const tableTab = tabs.find((tab): tab is TableDataTab => tab.type === 'table-data')
    if (!tableTab) {
      throw new Error('Expected table tab')
    }

    useTableDataStore.setState({
      tabs: {
        [tableTab.id]: makeTableDataTabState({
          rows: [[1, 'alice']],
          rowResidency: {
            status: 'resident',
            isActive: false,
            inactiveSince: 123,
          },
        }),
      },
    })

    useWorkspaceStore.getState().openTab(makeTab())

    await vi.waitFor(() => {
      expect(useTableDataStore.getState().tabs[tableTab.id]!.rowResidency).toEqual({
        status: 'resident',
        isActive: true,
        inactiveSince: null,
      })
    })
  })

  it('marks query result surfaces inactive and active when switching top-level tabs', () => {
    const queryTabId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')
    useWorkspaceStore.getState().openTab(makeSchemaTab({ objectName: 'orders', label: 'orders' }))
    const schemaTabId = useWorkspaceStore
      .getState()
      .tabsByConnection['conn-1'].find((tab) => tab.type === 'schema-info')?.id

    if (!schemaTabId) {
      throw new Error('Expected schema tab')
    }

    useQueryStore.setState({
      tabs: {
        [queryTabId]: makeQueryTabState({
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'query-1',
              rows: [[1, 'alice']],
              rowResidency: {
                status: 'resident',
                isActive: true,
                inactiveSince: null,
              },
            },
          ],
        }),
      },
    })
    useWorkspaceStore.getState().setActiveTab('conn-1', queryTabId)

    useWorkspaceStore.getState().setActiveTab('conn-1', schemaTabId)

    let result = useQueryStore.getState().tabs[queryTabId].results[0]
    expect(result.rowResidency.isActive).toBe(false)
    expect(result.rowResidency.inactiveSince).toBeTypeOf('number')

    useWorkspaceStore.getState().setActiveTab('conn-1', queryTabId)

    result = useQueryStore.getState().tabs[queryTabId].results[0]
    expect(result.rowResidency.isActive).toBe(true)
    expect(result.rowResidency.inactiveSince).toBeNull()
  })

  it('restores standalone table-data rows through table-data store activation', async () => {
    useWorkspaceStore.getState().openTab(makeTab())
    useWorkspaceStore.getState().openTab(makeSchemaTab({ objectName: 'orders', label: 'orders' }))

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const tableTab = tabs.find((tab): tab is TableDataTab => tab.type === 'table-data')
    const schemaTabId = tabs.find((tab) => tab.type === 'schema-info')?.id

    if (!tableTab || !schemaTabId) {
      throw new Error('Expected tabs')
    }

    useTableDataStore.setState({
      tabs: {
        [tableTab.id]: makeTableDataTabState({
          rows: [],
          rowResidency: {
            status: 'evicted',
            isActive: false,
            inactiveSince: Date.now(),
          },
        }),
      },
    })

    ipc.override('restore_table_data_cache', () => ({
      status: 'available',
      data: {
        columns: [],
        rows: [[1, 'alice']],
        currentPage: 1,
        pageSize: 1000,
        primaryKey: null,
        executionTimeMs: 5,
      },
    }))

    useWorkspaceStore.getState().setActiveTab('conn-1', tableTab.id)
    useWorkspaceStore.getState().setActiveTab('conn-1', schemaTabId)
    useWorkspaceStore.getState().setActiveTab('conn-1', tableTab.id)

    await vi.waitFor(() => {
      expect(useTableDataStore.getState().tabs[tableTab.id].rows).toEqual([[1, 'alice']])
      expect(useTableDataStore.getState().tabs[tableTab.id].rowResidency).toMatchObject({
        status: 'resident',
        isActive: true,
        inactiveSince: null,
      })
    })
  })

  it('switches bottom-panel visibility between result and table-data surfaces', async () => {
    setBottomPanelEnabled(true)
    const queryTabId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')
    useWorkspaceStore.getState().openTab(makeTab())

    const tableTab = useWorkspaceStore
      .getState()
      .tabsByConnection['conn-1'].find((tab): tab is TableDataTab => tab.type === 'table-data')

    if (!tableTab) {
      throw new Error('Expected scoped table-data tab')
    }

    useQueryStore.setState({
      tabs: {
        [queryTabId]: makeQueryTabState({
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'query-1',
              rows: [[1, 'alice']],
              rowResidency: {
                status: 'resident',
                isActive: true,
                inactiveSince: null,
              },
            },
          ],
        }),
      },
    })
    useTableDataStore.setState({
      tabs: {
        [tableTab.id]: makeTableDataTabState({
          rows: [],
          rowResidency: {
            status: 'evicted',
            isActive: false,
            inactiveSince: Date.now(),
          },
        }),
      },
    })
    ipc.override('restore_table_data_cache', () => ({
      status: 'available',
      data: {
        columns: [],
        rows: [[7, 'restored']],
        currentPage: 1,
        pageSize: 1000,
        primaryKey: null,
        executionTimeMs: 5,
      },
    }))

    useQueryStore.getState().setActiveBottomPanelItem(queryTabId, {
      type: 'table-data',
      tabId: tableTab.id,
    })

    await vi.waitFor(() => {
      expect(useQueryStore.getState().tabs[queryTabId]!.results[0]!.rowResidency.isActive).toBe(
        false
      )
      expect(useTableDataStore.getState().tabs[tableTab.id]!.rows).toEqual([[7, 'restored']])
      expect(useTableDataStore.getState().tabs[tableTab.id]!.rowResidency!.isActive).toBe(true)
    })

    useQueryStore.getState().setActiveBottomPanelItem(queryTabId, { type: 'result' })

    await vi.waitFor(() => {
      expect(useTableDataStore.getState().tabs[tableTab.id]!.rowResidency!.isActive).toBe(false)
      expect(useQueryStore.getState().tabs[queryTabId]!.results[0]!.rowResidency.isActive).toBe(
        true
      )
    })
  })

  it('keeps hidden results inactive when changing active result index and activates the new visible result', async () => {
    const queryTabId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')

    useQueryStore.setState({
      tabs: {
        [queryTabId]: makeQueryTabState({
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'query-1',
              rows: [[1, 'alice']],
              rowResidency: {
                status: 'resident',
                isActive: true,
                inactiveSince: null,
              },
            },
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'query-2',
              rows: [[2, 'bob']],
              rowResidency: {
                status: 'resident',
                isActive: false,
                inactiveSince: null,
              },
            },
          ],
          activeResultIndex: 0,
        }),
      },
    })

    useQueryStore.getState().setActiveBottomPanelItem(queryTabId, { type: 'result' })
    useQueryStore.getState().setActiveResultIndex(queryTabId, 1)

    await vi.waitFor(() => {
      const results = useQueryStore.getState().tabs[queryTabId].results
      expect(results[0].rowResidency.isActive).toBe(false)
      expect(results[1].rowResidency.isActive).toBe(true)
    })

    useQueryStore.getState().setActiveBottomPanelItem(queryTabId, {
      type: 'table-data',
      tabId: 'table-hidden',
    })
    useQueryStore.getState().setActiveResultIndex(queryTabId, 0)

    const results = useQueryStore.getState().tabs[queryTabId].results
    expect(results[0].rowResidency.isActive).toBe(false)
    expect(results[1].rowResidency.isActive).toBe(false)
  })
})

describe('useWorkspaceStore — setVisibleConnectionSession', () => {
  function seedActiveQueryResult(
    connectionId: string,
    title: string,
    queryId: string
  ): { queryTabId: string } {
    const queryTabId = useWorkspaceStore.getState().openQueryTab(connectionId, title)
    useQueryStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        [queryTabId]: makeQueryTabState({
          connectionId,
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId,
              rows: [[1, 'alice']],
              rowResidency: {
                status: 'resident',
                isActive: true,
                inactiveSince: null,
              },
            },
          ],
        }),
      },
    }))
    return { queryTabId }
  }

  it('is a no-op when the visible session does not change', () => {
    const { queryTabId } = seedActiveQueryResult('conn-1', 'Query 1', 'query-1')

    useWorkspaceStore.getState().setVisibleConnectionSession('conn-1')

    const result = useQueryStore.getState().tabs[queryTabId].results[0]
    expect(useWorkspaceStore.getState().visibleConnectionSessionId).toBe('conn-1')
    expect(result.rowResidency.isActive).toBe(true)
    expect(result.rowResidency.inactiveSince).toBeNull()
  })

  it('marks the previously visible surface inactive and the newly visible surface active', () => {
    const { queryTabId: firstTabId } = seedActiveQueryResult('conn-1', 'Query 1', 'query-1')

    // conn-2 has its own query tab with an inactive resident result.
    const secondTabId = useWorkspaceStore.getState().openQueryTab('conn-2', 'Query 2')
    useQueryStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        [secondTabId]: makeQueryTabState({
          connectionId: 'conn-2',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'query-2',
              rows: [[2, 'bob']],
              rowResidency: {
                status: 'resident',
                isActive: false,
                inactiveSince: 123,
              },
            },
          ],
        }),
      },
    }))

    useWorkspaceStore.getState().setVisibleConnectionSession('conn-2')

    expect(useWorkspaceStore.getState().visibleConnectionSessionId).toBe('conn-2')
    const previous = useQueryStore.getState().tabs[firstTabId].results[0]
    expect(previous.rowResidency.isActive).toBe(false)
    expect(previous.rowResidency.inactiveSince).toBeTypeOf('number')
    const next = useQueryStore.getState().tabs[secondTabId].results[0]
    expect(next.rowResidency.isActive).toBe(true)
    expect(next.rowResidency.inactiveSince).toBeNull()
  })

  it('only deactivates the previous surface when the new session has no active tab', () => {
    const { queryTabId } = seedActiveQueryResult('conn-1', 'Query 1', 'query-1')

    useWorkspaceStore.getState().setVisibleConnectionSession('conn-empty')

    expect(useWorkspaceStore.getState().visibleConnectionSessionId).toBe('conn-empty')
    const result = useQueryStore.getState().tabs[queryTabId].results[0]
    expect(result.rowResidency.isActive).toBe(false)
    expect(result.rowResidency.inactiveSince).toBeTypeOf('number')
  })

  it('deactivates the previous surface and reveals nothing when cleared with an empty session', () => {
    const { queryTabId } = seedActiveQueryResult('conn-1', 'Query 1', 'query-1')

    useWorkspaceStore.getState().setVisibleConnectionSession('')

    expect(useWorkspaceStore.getState().visibleConnectionSessionId).toBe('')
    const result = useQueryStore.getState().tabs[queryTabId].results[0]
    expect(result.rowResidency.isActive).toBe(false)
    expect(result.rowResidency.inactiveSince).toBeTypeOf('number')
  })

  it('does not activate row payloads when a background connection changes its active tab', async () => {
    // conn-1 is visible (top-level beforeEach). conn-2 is a background connection.
    const backgroundTabId = useWorkspaceStore.getState().openQueryTab('conn-2', 'Background')
    useQueryStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        [backgroundTabId]: makeQueryTabState({
          connectionId: 'conn-2',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'bg-query',
              rows: [[9, 'ghost']],
              rowResidency: {
                status: 'resident',
                isActive: false,
                inactiveSince: 123,
              },
            },
          ],
        }),
      },
    }))

    const secondBackgroundTabId = useWorkspaceStore
      .getState()
      .openQueryTab('conn-2', 'Background 2')

    // Selecting a tab in a background connection must not run activation effects.
    useWorkspaceStore.getState().setActiveTab('conn-2', secondBackgroundTabId)

    await vi.waitFor(() => {
      expect(useWorkspaceStore.getState().activeTabByConnection['conn-2']).toBe(
        secondBackgroundTabId
      )
    })
    // The previously-active background surface remains untouched (still inactive).
    const result = useQueryStore.getState().tabs[backgroundTabId].results[0]
    expect(result.rowResidency.isActive).toBe(false)
    expect(result.rowResidency.inactiveSince).toBe(123)
  })

  it('restores scoped standalone table-data rows when its connection becomes visible', async () => {
    // Start conn-bg as a background connection (no globally visible workspace).
    seedVisibleConnection('')

    useWorkspaceStore.getState().openTab(makeTab({ connectionId: 'conn-bg' }))
    const tableTab = useWorkspaceStore
      .getState()
      .tabsByConnection['conn-bg'].find((tab): tab is TableDataTab => tab.type === 'table-data')

    if (!tableTab) {
      throw new Error('Expected table-data tab')
    }

    useTableDataStore.setState({
      tabs: {
        [tableTab.id]: makeTableDataTabState({
          rows: [],
          rowResidency: {
            status: 'evicted',
            isActive: false,
            inactiveSince: Date.now(),
          },
        }),
      },
    })

    ipc.override('restore_table_data_cache', () => ({
      status: 'available',
      data: {
        columns: [],
        rows: [[42, 'visible']],
        currentPage: 1,
        pageSize: 1000,
        primaryKey: null,
        executionTimeMs: 5,
      },
    }))

    useWorkspaceStore.getState().setVisibleConnectionSession('conn-bg')

    await vi.waitFor(() => {
      expect(useTableDataStore.getState().tabs[tableTab.id].rows).toEqual([[42, 'visible']])
      expect(useTableDataStore.getState().tabs[tableTab.id].rowResidency).toMatchObject({
        status: 'resident',
        isActive: true,
        inactiveSince: null,
      })
    })
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

describe('useWorkspaceStore — renameQueryTab', () => {
  it('renames query-editor tabs only', () => {
    const queryTabId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Old Name')
    useWorkspaceStore.getState().openTab(makeTab({ label: 'users' }))
    const dataTabId = useWorkspaceStore
      .getState()
      .tabsByConnection['conn-1'].find((tab) => tab.type === 'table-data')?.id

    useWorkspaceStore.getState().renameQueryTab('conn-1', queryTabId, 'New Name')
    if (!dataTabId) {
      throw new Error('Expected table-data tab id')
    }
    useWorkspaceStore.getState().renameQueryTab('conn-1', dataTabId, 'Nope')

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    const queryTab = tabs.find((tab) => tab.id === queryTabId)
    const dataTab = tabs.find((tab) => tab.id === dataTabId)
    expect(queryTab?.label).toBe('New Name')
    expect(dataTab?.label).toBe('users')
  })

  it('rejects blank and whitespace-only labels', () => {
    const queryTabId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Original')
    useWorkspaceStore.getState().renameQueryTab('conn-1', queryTabId, '   ')
    useWorkspaceStore.getState().renameQueryTab('conn-1', queryTabId, '')

    const queryTab = useWorkspaceStore
      .getState()
      .tabsByConnection['conn-1'].find((tab) => tab.id === queryTabId)
    expect(queryTab?.label).toBe('Original')
  })
})

describe('useWorkspaceStore — reorderWorkspaceTab', () => {
  it('reorders movable tabs while keeping pinned tabs fixed', () => {
    useWorkspaceStore.getState().openHistoryTab('conn-1', false)
    useWorkspaceStore.getState().openProcessListTab('conn-1')
    const q1 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q1')
    const q2 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q2')
    const q3 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q3')

    useWorkspaceStore.getState().reorderWorkspaceTab('conn-1', q3, 0)

    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(tabs[0].type).toBe('history')
    expect(tabs[1].type).toBe('processlist')
    expect(tabs.slice(2).map((tab) => tab.id)).toEqual([q3, q1, q2])
    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(q3)
  })

  it('ignores pinned tab reorder requests', () => {
    useWorkspaceStore.getState().openHistoryTab('conn-1', false)
    useWorkspaceStore.getState().openProcessListTab('conn-1')
    useWorkspaceStore.getState().openQueryTab('conn-1', 'Q1')
    const before = useWorkspaceStore.getState().tabsByConnection['conn-1'].map((tab) => tab.id)
    const historyId = useWorkspaceStore
      .getState()
      .tabsByConnection['conn-1'].find((tab) => tab.type === 'history')?.id

    if (!historyId) {
      throw new Error('Expected history tab id')
    }

    useWorkspaceStore.getState().reorderWorkspaceTab('conn-1', historyId, 2)
    const after = useWorkspaceStore.getState().tabsByConnection['conn-1'].map((tab) => tab.id)
    expect(after).toEqual(before)
  })

  it('preserves AI tab state after rename and reorder', () => {
    const q1 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q1')
    const q2 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q2')

    useAiStore.setState({
      tabs: {
        [q1]: makeAiTabState({
          messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: 1 }],
          isPanelOpen: true,
        }),
      },
    })

    useWorkspaceStore.getState().renameQueryTab('conn-1', q1, 'Renamed Q1')
    useWorkspaceStore.getState().reorderWorkspaceTab('conn-1', q1, 2)

    expect(useAiStore.getState().tabs[q1]?.messages).toHaveLength(1)
    expect(useAiStore.getState().tabs[q1]?.isPanelOpen).toBe(true)
    expect(useAiStore.getState().tabs[q2]).toBeUndefined()
  })

  it('keeps scoped table-data children grouped with their parent query tab in bottom-panel mode', () => {
    setBottomPanelEnabled(true)
    const q1 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q1')
    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'users', label: 'users' }))
    const q2 = useWorkspaceStore.getState().openQueryTab('conn-1', 'Q2')
    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'orders', label: 'orders' }))

    useWorkspaceStore.getState().reorderWorkspaceTab('conn-1', q2, 0)

    expect(useWorkspaceStore.getState().tabsByConnection['conn-1'].map((tab) => tab.id)).toEqual([
      q2,
      useWorkspaceStore
        .getState()
        .tabsByConnection[
          'conn-1'
        ].find((tab) => tab.type === 'table-data' && tab.parentQueryTabId === q2)!.id,
      q1,
      useWorkspaceStore
        .getState()
        .tabsByConnection[
          'conn-1'
        ].find((tab) => tab.type === 'table-data' && tab.parentQueryTabId === q1)!.id,
    ])
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

  it('keeps focus in the same stack when closing an active query in mixed flat order', () => {
    const queryOneId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')
    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'users', label: 'users' }))
    const queryTwoId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 2')

    useWorkspaceStore.getState().setActiveTab('conn-1', queryOneId)
    useWorkspaceStore.getState().closeTab('conn-1', queryOneId)

    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(queryTwoId)
  })

  it('runs activation lifecycle for the tab revealed by closeTab', async () => {
    useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')
    const queryTabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id
    useQueryStore.setState({
      tabs: {
        [queryTabId]: makeQueryTabState({
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'query-restore-on-close',
              rows: [],
              rowResidency: {
                status: 'evicted',
                isActive: false,
                inactiveSince: 123,
              },
            },
          ],
        }),
      },
    })
    ipc.override('touch_results', () => ({ status: 'available' }))
    ipc.override('fetch_cached_rows', () => ({
      rows: [[77]],
      columns: [{ name: 'id', dataType: 'INT' }],
    }))

    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'users', label: 'users' }))
    const tableTabId = useWorkspaceStore
      .getState()
      .tabsByConnection['conn-1'].find((tab) => tab.type === 'table-data')!.id
    useTableDataStore.setState({
      tabs: {
        [tableTabId]: makeTableDataTabState(),
      },
    })

    useWorkspaceStore.getState().closeTab('conn-1', tableTabId)

    await vi.waitFor(() => {
      expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(queryTabId)
      expect(useQueryStore.getState().tabs[queryTabId].results[0].rowResidency).toEqual({
        status: 'resident',
        isActive: true,
        inactiveSince: null,
      })
      expect(useQueryStore.getState().tabs[queryTabId].results[0].rows).toEqual([[77]])
    })
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

  it('cascade-closes clean scoped table-data tabs when closing a query tab', () => {
    setBottomPanelEnabled(true)
    const queryTabId = useWorkspaceStore.getState().openQueryTab('conn-1')
    useWorkspaceStore.getState().openTab(makeTab())
    const cleanupSpy = vi.spyOn(useTableDataStore.getState(), 'cleanupTab')

    useWorkspaceStore.getState().closeTab('conn-1', queryTabId)

    expect(useWorkspaceStore.getState().pendingCascadeClose).toBeNull()
    expect(useWorkspaceStore.getState().tabsByConnection['conn-1']).toEqual([])
    expect(cleanupSpy).toHaveBeenCalledTimes(1)
  })

  it('opens a single discard-only cascade dialog for dirty query/table scoped tabs', () => {
    setBottomPanelEnabled(true)
    const queryTabId = useWorkspaceStore.getState().openQueryTab('conn-1')
    useWorkspaceStore.getState().openTab(makeTab())
    const tableTabId = useWorkspaceStore
      .getState()
      .tabsByConnection['conn-1'].find((tab) => tab.type === 'table-data')?.id

    if (!tableTabId) {
      throw new Error('Expected table-data tab')
    }

    useQueryStore.setState({
      tabs: {
        [queryTabId]: {
          ...useQueryStore.getState().getTabState(queryTabId),
          connectionId: 'conn-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              editState: { modifiedColumns: new Set(['name']) } as never,
            },
          ],
        },
      },
    })
    useTableDataStore.setState({
      tabs: {
        [tableTabId]: {
          editState: { modifiedColumns: new Set(['name']) },
        } as never,
      },
    })

    useWorkspaceStore.getState().closeTab('conn-1', queryTabId)

    const pending = useWorkspaceStore.getState().pendingCascadeClose
    expect(pending).not.toBeNull()
    expect(pending?.queryResultItems).toEqual(['Result 1'])
    expect(pending?.tableDataItems).toEqual(['users'])
    expect(useWorkspaceStore.getState().tabsByConnection['conn-1']).toHaveLength(2)
  })

  it('keeps tabs open when the cascade close is cancelled', () => {
    setBottomPanelEnabled(true)
    const queryTabId = useWorkspaceStore.getState().openQueryTab('conn-1')
    useWorkspaceStore.getState().openTab(makeTab())
    const tableTabId = useWorkspaceStore
      .getState()
      .tabsByConnection['conn-1'].find((tab) => tab.type === 'table-data')?.id

    if (!tableTabId) {
      throw new Error('Expected table-data tab')
    }

    useTableDataStore.setState({
      tabs: {
        [tableTabId]: {
          editState: { modifiedColumns: new Set(['name']) },
        } as never,
      },
    })

    useWorkspaceStore.getState().closeTab('conn-1', queryTabId)
    useWorkspaceStore.getState().pendingCascadeClose?.onCancel()

    expect(useWorkspaceStore.getState().pendingCascadeClose).toBeNull()
    expect(useWorkspaceStore.getState().tabsByConnection['conn-1']).toHaveLength(2)
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

  it('keeps focus in the same stack when closing the active database tab in mixed flat order', () => {
    useWorkspaceStore
      .getState()
      .openTab(makeSchemaTab({ databaseName: 'db1', objectName: 'users', label: 'users schema' }))
    const schemaOneId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id
    useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')
    useWorkspaceStore
      .getState()
      .openTab(makeSchemaTab({ databaseName: 'db2', objectName: 'orders', label: 'orders schema' }))
    const schemaTwoId = useWorkspaceStore.getState().tabsByConnection['conn-1'][2].id

    useWorkspaceStore.getState().setActiveTab('conn-1', schemaOneId)
    useWorkspaceStore.getState().closeTabsByDatabase('conn-1', 'db1')

    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(schemaTwoId)
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

  it('keeps focus in the same stack when closing the active object tab in mixed flat order', () => {
    useWorkspaceStore.getState().openTab(makeSchemaTab({ objectName: 'users', label: 'users schema' }))
    const schemaOneId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id
    useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')
    useWorkspaceStore.getState().openTab(makeSchemaTab({ objectName: 'orders', label: 'orders schema' }))
    const schemaTwoId = useWorkspaceStore.getState().tabsByConnection['conn-1'][2].id

    useWorkspaceStore.getState().setActiveTab('conn-1', schemaOneId)
    useWorkspaceStore.getState().closeTabsByObject('conn-1', 'mydb', 'users')

    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(schemaTwoId)
  })

  it('falls back the active scoped bottom-panel table tab to results when bulk removal closes it', () => {
    setBottomPanelEnabled(true)
    const queryTabId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')
    useQueryStore.setState({
      tabs: {
        [queryTabId]: makeQueryTabState({
          connectionId: 'conn-1',
          activeBottomPanelItem: { type: 'result' },
        }),
      },
    })

    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'users', label: 'users' }))

    const tableTabId = useWorkspaceStore
      .getState()
      .tabsByConnection['conn-1'].find(
        (tab): tab is TableDataTab =>
          tab.type === 'table-data' && tab.parentQueryTabId === queryTabId
      )?.id

    expect(tableTabId).toBeTruthy()
    expect(useQueryStore.getState().getTabState(queryTabId).activeBottomPanelItem).toEqual({
      type: 'table-data',
      tabId: tableTabId,
    })

    useWorkspaceStore.getState().closeTabsByObject('conn-1', 'mydb', 'users')

    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(queryTabId)
    expect(useWorkspaceStore.getState().tabsByConnection['conn-1']).toEqual([
      expect.objectContaining({ id: queryTabId, type: 'query-editor' }),
    ])
    expect(useQueryStore.getState().getTabState(queryTabId).activeBottomPanelItem).toEqual({
      type: 'result',
    })
  })
})

describe('useWorkspaceStore — updateTabDatabase', () => {
  it('renames database in tab identifiers', () => {
    useWorkspaceStore.getState().openTab(makeTab({ databaseName: 'olddb', label: 'olddb.users' }))
    useWorkspaceStore.getState().updateTabDatabase('conn-1', 'olddb', 'newdb')

    const state = useWorkspaceStore.getState()
    const tabs = state.tabsByConnection['conn-1']
    expect((tabs[0] as TableDataTab).databaseName).toBe('newdb')
    expect(tabs[0].label).toBe('users')
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
    expect(tabs[0].label).toBe('new_table')
  })
})

describe('useWorkspaceStore — table-data tab label should only show object name', () => {
  it('updateTabObject sets label to only objectName for table-data tabs', () => {
    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'old_table', label: 'old_table' }))
    useWorkspaceStore.getState().updateTabObject('conn-1', 'mydb', 'old_table', 'new_table')

    const state = useWorkspaceStore.getState()
    const tabs = state.tabsByConnection['conn-1']
    expect(tabs[0].label).toBe('new_table')
  })

  it('updateTabDatabase sets label to only objectName for table-data tabs', () => {
    useWorkspaceStore.getState().openTab(makeTab({ databaseName: 'olddb', label: 'users' }))
    useWorkspaceStore.getState().updateTabDatabase('conn-1', 'olddb', 'newdb')

    const state = useWorkspaceStore.getState()
    const tabs = state.tabsByConnection['conn-1']
    expect(tabs[0].label).toBe('users')
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

  it('runs activation lifecycle for the tab revealed by forceCloseTab', async () => {
    useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')
    const queryTabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id
    useQueryStore.setState({
      tabs: {
        [queryTabId]: makeQueryTabState({
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'query-restore-on-force-close',
              rows: [],
              rowResidency: {
                status: 'evicted',
                isActive: false,
                inactiveSince: 456,
              },
            },
          ],
        }),
      },
    })
    ipc.override('touch_results', () => ({ status: 'available' }))
    ipc.override('fetch_cached_rows', () => ({
      rows: [[88]],
      columns: [{ name: 'id', dataType: 'INT' }],
    }))

    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'users', label: 'users' }))
    const tableTabId = useWorkspaceStore
      .getState()
      .tabsByConnection['conn-1'].find((tab) => tab.type === 'table-data')!.id
    useTableDataStore.setState({
      tabs: {
        [tableTabId]: makeTableDataTabState(),
      },
    })

    useWorkspaceStore.getState().forceCloseTab('conn-1', tableTabId)

    await vi.waitFor(() => {
      expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(queryTabId)
      expect(useQueryStore.getState().tabs[queryTabId].results[0].rowResidency).toEqual({
        status: 'resident',
        isActive: true,
        inactiveSince: null,
      })
      expect(useQueryStore.getState().tabs[queryTabId].results[0].rows).toEqual([[88]])
    })
  })

  it('keeps focus in the same stack when force-closing an active query in mixed flat order', () => {
    const queryOneId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')
    useWorkspaceStore.getState().openTab(makeTab({ objectName: 'users', label: 'users' }))
    const queryTwoId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 2')

    useWorkspaceStore.getState().setActiveTab('conn-1', queryOneId)
    useWorkspaceStore.getState().forceCloseTab('conn-1', queryOneId)

    expect(useWorkspaceStore.getState().activeTabByConnection['conn-1']).toBe(queryTwoId)
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
    ipc.override('evict_results', () => null)
  })

  it('switches to dirty result and sets pendingNavigationAction when dirty result is non-active', () => {
    // Open a query-editor tab
    const tabId = useWorkspaceStore.getState().openQueryTab('conn-1')

    // Set up query store with a dirty non-active result (index 1 is dirty, active is 0)
    useQueryStore.setState({
      tabs: {
        [tabId]: {
          content: 'SELECT 1; SELECT 2',
          selectedText: '',
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
              rowResidency: {
                status: 'resident',
                isActive: true,
                inactiveSince: null,
              },
            },
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q2',
              rowResidency: {
                status: 'resident',
                isActive: false,
                inactiveSince: null,
              },
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
          activeBottomPanelItem: { type: 'result' },
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
    expect(queryTab?.results[0]?.rowResidency.isActive).toBe(false)
    expect(queryTab?.results[1]?.rowResidency.isActive).toBe(true)

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
          selectedText: '',
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
          activeBottomPanelItem: { type: 'result' },
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
          selectedText: '',
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
          activeBottomPanelItem: { type: 'result' },
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
          selectedText: '',
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
          activeBottomPanelItem: { type: 'result' },
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
    ipc.override('evict_results', () => null)
  })

  it('closeTab on query-editor tab cleans up AI store state', () => {
    const tabId = useWorkspaceStore.getState().openQueryTab('conn-1')

    // Set up AI state for the tab
    useAiStore.setState({
      tabs: {
        [tabId]: makeAiTabState({
          messages: [{ id: '1', role: 'user', content: 'hello', timestamp: 1 }],
          isPanelOpen: true,
        }),
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
        [tabId]: makeAiTabState(),
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
        [tabId1]: makeAiTabState({ isPanelOpen: true }),
        [tabId2]: makeAiTabState(),
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
        [tabId]: makeAiTabState(),
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
        [tabId]: makeAiTabState(),
      },
    })

    useWorkspaceStore.getState().closeTabsByObject('conn-1', 'mydb', 'users')

    expect(useAiStore.getState().tabs[tabId]).toBeUndefined()
  })

  it('tracks runtime stack recency for non-pinned top-level tabs only', () => {
    const queryTabId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')

    useWorkspaceStore.getState().openTab(makeSchemaTab({ objectName: 'orders', label: 'orders' }))
    const schemaTabId = useWorkspaceStore.getState().tabsByConnection['conn-1'].find(
      (tab) => tab.type === 'schema-info'
    )?.id

    useWorkspaceStore.getState().openHistoryTab('conn-1')

    expect(useWorkspaceStore.getState().stackRecencyByConnection['conn-1']).toEqual({
      queries: queryTabId,
      schema: schemaTabId,
    })
  })

  it('cleans up stale stack recency when tabs close or connection state clears', () => {
    const queryTabId = useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')
    expect(useWorkspaceStore.getState().stackRecencyByConnection['conn-1']).toEqual({
      queries: queryTabId,
    })

    useWorkspaceStore.getState().closeTab('conn-1', queryTabId)
    expect(useWorkspaceStore.getState().stackRecencyByConnection['conn-1']).toEqual({})

    useWorkspaceStore.getState().openTab(makeSchemaTab())
    const schemaTabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id
    expect(useWorkspaceStore.getState().stackRecencyByConnection['conn-1']).toEqual({
      schema: schemaTabId,
    })

    useWorkspaceStore.getState().clearConnectionTabs('conn-1')
    expect(useWorkspaceStore.getState().stackRecencyByConnection['conn-1']).toBeUndefined()
  })

  it('remaps table stack recency when scope normalization removes a scoped duplicate', () => {
    useWorkspaceStore.getState().openTab(makeTab())
    const standaloneTabId = useWorkspaceStore.getState().tabsByConnection['conn-1'][0].id

    setBottomPanelEnabled(true)
    useWorkspaceStore.getState().openQueryTab('conn-1', 'Query 1')
    useWorkspaceStore.getState().openTab(makeTab())

    setBottomPanelEnabled(false)
    useWorkspaceStore.getState().normalizeTableDataTabScopes()

    expect(useWorkspaceStore.getState().stackRecencyByConnection['conn-1']).toMatchObject({
      tables: standaloneTabId,
    })
  })
})
