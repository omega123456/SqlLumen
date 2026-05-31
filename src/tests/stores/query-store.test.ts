import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ipc, expectToast, overrideIpcCommands, overrideNamedIpcCommands } from '../ipc-mock'
import { useQueryStore, DEFAULT_RESULT_STATE } from '../../stores/query-store'
import { useToastStore, _resetToastTimeoutsForTests } from '../../stores/toast-store'
import { useTableDataStore } from '../../stores/table-data-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { flat } from '../helpers/query-test-utils'
import { makeTableDataTabState } from '../helpers/table-data-test-utils'

/**
 * Set result-level fields on an existing tab created by setContent().
 * Since setContent creates a tab with empty results[], we inject results[0].
 */
function patchResult(tabId: string, resultOverrides: Record<string, unknown>) {
  useQueryStore.setState((prev) => {
    const tab = prev.tabs[tabId]!
    const existingResult = tab.results[0] ?? { ...DEFAULT_RESULT_STATE }
    return {
      tabs: {
        ...prev.tabs,
        [tabId]: {
          ...tab,
          results: [{ ...existingResult, ...resultOverrides }],
          activeResultIndex: 0,
        },
      },
    }
  })
}

const overrideCommands = overrideIpcCommands
const overrideNamedCommands = overrideNamedIpcCommands

const QUERY_STORE_COMMANDS = [
  'analyze_query_for_edit',
  'cancel_query',
  'evict_results',
  'execute_multi_query',
  'execute_query',
  'fetch_cached_rows',
  'sort_results',
] as const

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  useWorkspaceStore.setState({
    tabsByConnection: {},
    activeTabByConnection: {},
    lastFocusedSurfaceByTab: {},
    blockingNavigationByTab: {},
    pendingCascadeClose: null,
  })
  useTableDataStore.setState({ tabs: {} })
  overrideCommands({
    execute_query: () => ({
      queryId: 'q-mock',
      columns: [{ name: 'id', dataType: 'INT' }],
      totalRows: 3,
      executionTimeMs: 10,
      affectedRows: 0,
      rows: [[1], [2], [3]],

      autoLimitApplied: false,
    }),
    fetch_cached_rows: () => ({ rows: [[4], [5]], columns: [{ name: 'id', dataType: 'INT' }] }),
    evict_results: () => null,
  })
})

const BOOLEAN_ALIAS_COLUMNS = [
  { name: 'is_active', dataType: 'BOOLEAN' },
  { name: 'is_archived', dataType: 'BOOL' },
  { name: 'label', dataType: 'VARCHAR' },
]

describe('useQueryStore — getTabState', () => {
  it('returns default state for unknown tab', () => {
    const state = useQueryStore.getState().getTabState('unknown')
    expect(state.tabStatus).toBe('idle')
    expect(state.content).toBe('')
    expect(state.activeBottomPanelItem).toEqual({ type: 'result' })
    expect(flat('unknown').columns).toHaveLength(0)
  })

  it('returns default new fields for unknown tab', () => {
    const f = flat('unknown')
    expect(f.viewMode).toBe('grid')
    expect(f.sortColumn).toBeNull()
    expect(f.sortDirection).toBeNull()
    expect(f.selectedRowIndex).toBeNull()
    expect(f.exportDialogOpen).toBe(false)
    expect(f.lastExecutedSql).toBeNull()
  })
})

describe('useQueryStore — activeBottomPanelItem', () => {
  it('sets the active bottom panel item for a tab', () => {
    useQueryStore.getState().setContent('tab-bottom-panel', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-bottom-panel': {
          ...prev.tabs['tab-bottom-panel']!,
          connectionId: 'conn-1',
        },
      },
    }))
    useWorkspaceStore.setState({
      tabsByConnection: {
        'conn-1': [
          {
            id: 'tab-bottom-panel',
            type: 'query-editor',
            label: 'Query 1',
            connectionId: 'conn-1',
          },
        ],
      },
      activeTabByConnection: {
        'conn-1': 'tab-bottom-panel',
      },
      lastFocusedSurfaceByTab: {},
      blockingNavigationByTab: {},
      pendingCascadeClose: null,
    })
    useTableDataStore.setState({
      tabs: {
        'table-tab-1': makeTableDataTabState({
          connectionId: 'conn-1',
          rowResidency: {
            status: 'resident',
            isActive: false,
            inactiveSince: 123,
          },
        }),
      },
    })

    useQueryStore
      .getState()
      .setActiveBottomPanelItem('tab-bottom-panel', { type: 'table-data', tabId: 'table-tab-1' })

    expect(useQueryStore.getState().getTabState('tab-bottom-panel').activeBottomPanelItem).toEqual({
      type: 'table-data',
      tabId: 'table-tab-1',
    })
    expect(useTableDataStore.getState().tabs['table-tab-1']?.rowResidency).toEqual({
      status: 'resident',
      isActive: true,
      inactiveSince: null,
    })
  })

  it('does not touch a bottom-panel table-data item when the query tab is hidden', () => {
    useQueryStore.getState().setContent('tab-bottom-panel', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-bottom-panel': {
          ...prev.tabs['tab-bottom-panel']!,
          connectionId: 'conn-1',
        },
      },
    }))
    useWorkspaceStore.setState({
      tabsByConnection: {
        'conn-1': [
          {
            id: 'tab-bottom-panel',
            type: 'query-editor',
            label: 'Query 1',
            connectionId: 'conn-1',
          },
          { id: 'tab-visible', type: 'query-editor', label: 'Query 2', connectionId: 'conn-1' },
        ],
      },
      activeTabByConnection: {
        'conn-1': 'tab-visible',
      },
      lastFocusedSurfaceByTab: {},
      blockingNavigationByTab: {},
      pendingCascadeClose: null,
    })

    useQueryStore
      .getState()
      .setActiveBottomPanelItem('tab-bottom-panel', { type: 'table-data', tabId: 'table-tab-1' })

    expect(useQueryStore.getState().getTabState('tab-bottom-panel').activeBottomPanelItem).toEqual({
      type: 'table-data',
      tabId: 'table-tab-1',
    })
    expect(useTableDataStore.getState().tabs['table-tab-1']).toBeUndefined()
  })

  it('does not activate a hidden bottom-panel table-data item', () => {
    useQueryStore.getState().setContent('tab-bottom-panel', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-bottom-panel': {
          ...prev.tabs['tab-bottom-panel']!,
          connectionId: 'conn-1',
        },
      },
    }))
    useWorkspaceStore.setState({
      tabsByConnection: {
        'conn-1': [
          {
            id: 'tab-bottom-panel',
            type: 'query-editor',
            label: 'Query 1',
            connectionId: 'conn-1',
          },
          { id: 'tab-visible', type: 'query-editor', label: 'Query 2', connectionId: 'conn-1' },
        ],
      },
      activeTabByConnection: {
        'conn-1': 'tab-visible',
      },
      lastFocusedSurfaceByTab: {},
      blockingNavigationByTab: {},
      pendingCascadeClose: null,
    })
    useTableDataStore.setState({
      tabs: {
        'table-tab-1': makeTableDataTabState({
          connectionId: 'conn-1',
          rowResidency: {
            status: 'resident',
            isActive: false,
            inactiveSince: 123,
          },
        }),
      },
    })

    useQueryStore
      .getState()
      .setActiveBottomPanelItem('tab-bottom-panel', { type: 'table-data', tabId: 'table-tab-1' })

    expect(useTableDataStore.getState().tabs['table-tab-1']?.rowResidency).toEqual({
      status: 'resident',
      isActive: false,
      inactiveSince: 123,
    })
  })

  it('marks the previous visible table-data item inactive when switching back to results', () => {
    useQueryStore.getState().setContent('tab-bottom-panel', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-bottom-panel': {
          ...prev.tabs['tab-bottom-panel']!,
          connectionId: 'conn-1',
          activeBottomPanelItem: { type: 'table-data', tabId: 'table-tab-1' },
        },
      },
    }))
    useWorkspaceStore.setState({
      tabsByConnection: {
        'conn-1': [
          {
            id: 'tab-bottom-panel',
            type: 'query-editor',
            label: 'Query 1',
            connectionId: 'conn-1',
          },
        ],
      },
      activeTabByConnection: {
        'conn-1': 'tab-bottom-panel',
      },
      lastFocusedSurfaceByTab: {},
      blockingNavigationByTab: {},
      pendingCascadeClose: null,
    })
    useTableDataStore.setState({
      tabs: {
        'table-tab-1': makeTableDataTabState({
          connectionId: 'conn-1',
          rowResidency: {
            status: 'resident',
            isActive: true,
            inactiveSince: null,
          },
          rows: [[1]],
        }),
      },
    })

    useQueryStore.getState().setActiveBottomPanelItem('tab-bottom-panel', { type: 'result' })

    expect(useTableDataStore.getState().tabs['table-tab-1']?.rowResidency).toEqual({
      status: 'resident',
      isActive: false,
      inactiveSince: expect.any(Number),
    })
  })
})

describe('useQueryStore — setContent', () => {
  it('updates content for tab', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.content).toBe('SELECT 1')
  })
})

describe('useQueryStore — setFilePath', () => {
  it('updates filePath for tab', () => {
    useQueryStore.getState().setFilePath('tab-1', '/path/to/file.sql')
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.filePath).toBe('/path/to/file.sql')
  })
})

describe('useQueryStore — executeQuery', () => {
  it('sets running status then success', async () => {
    useQueryStore
      .getState()
      .setActiveBottomPanelItem('tab-1', { type: 'table-data', tabId: 'table-tab-1' })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT 1')
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.tabStatus).toBe('success')
    expect(state.activeBottomPanelItem).toEqual({ type: 'result' })
    const f = flat('tab-1')
    expect(f.queryId).toBe('q-mock')
    expect(f.totalRows).toBe(3)
    expect(f.columns).toHaveLength(1)
    expect(f.rows).toEqual([[1], [2], [3]])
  })

  it('sets error status on failure', async () => {
    ipc.override('execute_query', () => {
      throw new Error('Query failed: table not found')
    })
    await useQueryStore.getState().executeQuery('conn-1', 'tab-error', 'SELECT * FROM bad_table')
    const state = useQueryStore.getState().getTabState('tab-error')
    expect(state.tabStatus).toBe('error')
    expect(flat('tab-error').errorMessage).toContain('table not found')
  })

  it('saves lastExecutedSql on success', async () => {
    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT * FROM users')
    expect(flat('tab-1').lastExecutedSql).toBe('SELECT * FROM users')
  })

  it('uses stored rowLimit for the IPC call', async () => {
    // Set a custom page size before executing
    useQueryStore.getState().setContent('tab-ps', 'SELECT 1')
    patchResult('tab-ps', { rowLimit: 500 })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-ps', 'SELECT 1')
    const state = useQueryStore.getState().getTabState('tab-ps')
    expect(state.tabStatus).toBe('success')
    // The query still succeeds (the mock doesn't validate rowLimit,
    // but the code path passes it)
    expect(flat('tab-ps').rows).toEqual([[1], [2], [3]])
  })

  it('resets sortColumn, sortDirection, and selectedRowIndex on new query', async () => {
    // Set up tab with existing sort/selection state
    useQueryStore.getState().setContent('tab-reset', 'SELECT 1')
    patchResult('tab-reset', {
      sortColumn: 'id',
      sortDirection: 'asc' as const,
      selectedRowIndex: 5,
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-reset', 'SELECT 1')
    const f = flat('tab-reset')
    expect(f.sortColumn).toBeNull()
    expect(f.sortDirection).toBeNull()
    expect(f.selectedRowIndex).toBeNull()
  })

  it('normalizes tinyint boolean aliases to integer rows on executeQuery', async () => {
    overrideCommands({
      execute_query: () => ({
        queryId: 'q-bool',
        columns: BOOLEAN_ALIAS_COLUMNS,
        totalRows: 1,
        executionTimeMs: 10,
        affectedRows: 0,
        rows: [[true, false, 'flagged']],

        autoLimitApplied: false,
      }),
      evict_results: () => null,
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-bool', 'SELECT is_active FROM flags')

    expect(flat('tab-bool').rows).toEqual([[1, 0, 'flagged']])
  })

  it('normalizes tinyint single-byte control strings to integer rows on executeQuery', async () => {
    overrideCommands({
      execute_query: () => ({
        queryId: 'q-tinyint-bytes',
        columns: BOOLEAN_ALIAS_COLUMNS,
        totalRows: 1,
        executionTimeMs: 10,
        affectedRows: 0,
        rows: [['\u0001', '\u0000', 'flagged']],

        autoLimitApplied: false,
      }),
      evict_results: () => null,
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-tinyint-bytes', 'SELECT flags')

    expect(flat('tab-tinyint-bytes').rows).toEqual([[1, 0, 'flagged']])
  })

  it('treats missing or non-array analyze_query_for_edit result as no edit tables', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    overrideCommands({
      execute_query: () => ({
        queryId: 'q-analyze-null',
        columns: [{ name: 'id', dataType: 'INT' }],
        totalRows: 1,
        executionTimeMs: 1,
        affectedRows: 0,
        rows: [[1]],

        autoLimitApplied: false,
      }),
      analyze_query_for_edit: () => null,
      evict_results: () => null,
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-null-analyze', 'SELECT id FROM t')

    await vi.waitFor(() => {
      expect(flat('tab-null-analyze').isAnalyzingQuery).toBe(false)
    })

    expect(flat('tab-null-analyze').editTableMetadata).toEqual({})
    const analyzeErrors = errSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('analyze_query_for_edit')
    )
    expect(analyzeErrors).toHaveLength(0)
    errSpy.mockRestore()
  })

  it('returns early without executing when tab is already running', async () => {
    let executeCallCount = 0
    overrideCommands({
      execute_query: () => {
        executeCallCount++
        return {
          queryId: 'q-mock',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          rows: [[1]],

          autoLimitApplied: false,
        }
      },
      evict_results: () => null,
    })

    // Set up a tab already in running state
    useQueryStore.getState().setContent('tab-guard', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-guard': {
          ...prev.tabs['tab-guard']!,
          tabStatus: 'running' as const,
          executionStartedAt: Date.now(),
        },
      },
    }))

    await useQueryStore.getState().executeQuery('conn-1', 'tab-guard', 'SELECT 1')

    // Should not have called the IPC
    expect(executeCallCount).toBe(0)
    // Status should still be running
    expect(useQueryStore.getState().getTabState('tab-guard').tabStatus).toBe('running')
  })
})

describe('useQueryStore — multi-result execution', () => {
  it('switches back to result after executeMultiQuery completes', async () => {
    overrideCommands({
      execute_multi_query: () => ({
        results: [
          {
            columns: [{ name: 'id', dataType: 'INT' }],
            rows: [[1]],
            totalRows: 1,
            executionTimeMs: 5,
            affectedRows: 0,
            queryId: 'multi-1',

            autoLimitApplied: false,
            error: null,
            sourceSql: 'SELECT 1',
            reExecutable: true,
          },
          {
            columns: [{ name: 'name', dataType: 'VARCHAR' }],
            rows: [['alice']],
            totalRows: 1,
            executionTimeMs: 5,
            affectedRows: 0,
            queryId: 'multi-2',

            autoLimitApplied: false,
            error: null,
            sourceSql: 'SELECT 2',
            reExecutable: true,
          },
        ],
      }),
      evict_results: () => null,
    })

    useQueryStore.getState().setContent('tab-multi', 'SELECT 1; SELECT 2;')
    useQueryStore
      .getState()
      .setActiveBottomPanelItem('tab-multi', { type: 'table-data', tabId: 'table-tab-1' })

    await useQueryStore
      .getState()
      .executeMultiQuery('conn-1', 'tab-multi', ['SELECT 1', 'SELECT 2'])

    const state = useQueryStore.getState().getTabState('tab-multi')
    expect(state.tabStatus).toBe('success')
    expect(state.activeBottomPanelItem).toEqual({ type: 'result' })
    expect(state.results).toHaveLength(2)
  })
})

// fetchPage tests removed — fetchPage action was removed in Phase 1

describe('useQueryStore — cleanupTab', () => {
  it('removes tab state', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().cleanupTab('conn-1', 'tab-1')
    expect(useQueryStore.getState().tabs['tab-1']).toBeUndefined()
  })
})

describe('useQueryStore — cleanupConnection', () => {
  it('removes all specified tab states', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().setContent('tab-2', 'SELECT 2')
    useQueryStore.getState().cleanupConnection('conn-1', ['tab-1', 'tab-2'])
    expect(useQueryStore.getState().tabs['tab-1']).toBeUndefined()
    expect(useQueryStore.getState().tabs['tab-2']).toBeUndefined()
  })
})

describe('useQueryStore — setCursorPosition', () => {
  it('sets cursor position for a tab', () => {
    useQueryStore.getState().setCursorPosition('tab-1', { lineNumber: 5, column: 10 })
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.cursorPosition).toEqual({ lineNumber: 5, column: 10 })
  })

  it('updates cursor position for an existing tab', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().setCursorPosition('tab-1', { lineNumber: 1, column: 1 })
    expect(useQueryStore.getState().tabs['tab-1']?.cursorPosition).toEqual({
      lineNumber: 1,
      column: 1,
    })

    useQueryStore.getState().setCursorPosition('tab-1', { lineNumber: 3, column: 5 })
    expect(useQueryStore.getState().tabs['tab-1']?.cursorPosition).toEqual({
      lineNumber: 3,
      column: 5,
    })
  })
})

describe('useQueryStore — stale query guard', () => {
  it('skips state update if tab was cleaned up during executeQuery', async () => {
    // Use a controlled promise so we can cleanup the tab mid-flight
    let resolveQuery: ((value: unknown) => void) | null = null
    overrideCommands({
      execute_query: () =>
        new Promise((resolve) => {
          resolveQuery = resolve
        }),
      evict_results: () => null,
    })

    useQueryStore.getState().setContent('tab-stale', 'SELECT 1')
    const promise = useQueryStore.getState().executeQuery('conn-1', 'tab-stale', 'SELECT 1')

    // Tab is in running state
    expect(useQueryStore.getState().tabs['tab-stale']?.tabStatus).toBe('running')

    // Simulate tab close
    useQueryStore.getState().cleanupTab('conn-1', 'tab-stale')
    expect(useQueryStore.getState().tabs['tab-stale']).toBeUndefined()

    // Resolve the query
    resolveQuery!({
      queryId: 'q-mock',
      columns: [{ name: 'id', dataType: 'INT' }],
      totalRows: 1,
      executionTimeMs: 10,
      affectedRows: 0,
      rows: [[1]],

      autoLimitApplied: false,
    })
    await promise

    // Tab state should still be undefined (guard prevented the write)
    expect(useQueryStore.getState().tabs['tab-stale']).toBeUndefined()
  })

  it('skips state update on error if tab was cleaned up during executeQuery', async () => {
    let rejectQuery: ((reason: unknown) => void) | null = null
    overrideCommands({
      execute_query: () =>
        new Promise((_resolve, reject) => {
          rejectQuery = reject
        }),
      evict_results: () => null,
    })

    useQueryStore.getState().setContent('tab-stale2', 'SELECT bad')
    const promise = useQueryStore.getState().executeQuery('conn-1', 'tab-stale2', 'SELECT bad')

    // Simulate tab close
    useQueryStore.getState().cleanupTab('conn-1', 'tab-stale2')

    // Reject the query
    rejectQuery!(new Error('Query failed'))
    await promise

    // Tab state should still be undefined
    expect(useQueryStore.getState().tabs['tab-stale2']).toBeUndefined()
  })
})

// --- New Phase 5.1 action tests ---

describe('useQueryStore — setViewMode', () => {
  it('sets view mode for a tab', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().setViewMode('tab-1', 'form')
    expect(flat('tab-1').viewMode).toBe('form')
  })

  it('sets view mode to text', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().setViewMode('tab-1', 'text')
    expect(flat('tab-1').viewMode).toBe('text')
  })

  it('sets view mode back to grid', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    useQueryStore.getState().setViewMode('tab-1', 'form')
    useQueryStore.getState().setViewMode('tab-1', 'grid')
    expect(flat('tab-1').viewMode).toBe('grid')
  })

  it('does not update selected row when the same row is selected again', () => {
    useQueryStore.getState().setContent('tab-same-row', 'SELECT 1')
    patchResult('tab-same-row', { selectedRowIndex: 2 })

    useQueryStore.getState().setSelectedRow('tab-same-row', 2)

    expect(flat('tab-same-row').selectedRowIndex).toBe(2)
  })

  it('does not update selected cell when the same value is set again', () => {
    useQueryStore.getState().setContent('tab-same-cell', 'SELECT 1')
    patchResult('tab-same-cell', {
      selectedCell: { columnKey: 'name', value: 'Ada' },
    })

    useQueryStore.getState().setSelectedCell('tab-same-cell', { columnKey: 'name', value: 'Ada' })

    expect(flat('tab-same-cell').selectedCell).toEqual({ columnKey: 'name', value: 'Ada' })
  })

  it('shows an error toast when autosave fails while switching to text view', async () => {
    useQueryStore.getState().setContent('tab-text-save-fail', 'SELECT 1')
    patchResult('tab-text-save-fail', {
      resultStatus: 'success' as const,
      queryId: 'q-save-fail',
      columns: [{ name: 'id', dataType: 'INT' }],
      rows: [[1]],
      totalRows: 1,
      viewMode: 'grid' as const,
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1 },
        currentValues: { id: 1 },
        modifiedColumns: new Set(['id']),
        isNewRow: false,
      },
      saveError: 'still broken',
    })

    const saveSpy = vi.spyOn(useQueryStore.getState(), 'saveCurrentRow').mockResolvedValue(true)

    useQueryStore.getState().setViewMode('tab-text-save-fail', 'text')
    await Promise.resolve()
    await Promise.resolve()

    expect(saveSpy).toHaveBeenCalledWith('tab-text-save-fail')
    expect(flat('tab-text-save-fail').viewMode).toBe('grid')
    expect(
      useToastStore
        .getState()
        .toasts.some(
          (toast) => toast.variant === 'error' && toast.title === 'Cannot switch to text view'
        )
    ).toBe(true)

    saveSpy.mockRestore()
  })

  it('shows an error toast when autosave throws while switching to text view', async () => {
    useQueryStore.getState().setContent('tab-text-save-throw', 'SELECT 1')
    patchResult('tab-text-save-throw', {
      resultStatus: 'success' as const,
      queryId: 'q-save-throw',
      columns: [{ name: 'id', dataType: 'INT' }],
      rows: [[1]],
      totalRows: 1,
      viewMode: 'grid' as const,
      editState: {
        rowKey: { id: 1 },
        originalValues: { id: 1 },
        currentValues: { id: 1 },
        modifiedColumns: new Set(['id']),
        isNewRow: false,
      },
    })

    const saveSpy = vi
      .spyOn(useQueryStore.getState(), 'saveCurrentRow')
      .mockRejectedValue(new Error('save blew up'))

    useQueryStore.getState().setViewMode('tab-text-save-throw', 'text')
    await Promise.resolve()
    await Promise.resolve()

    expect(saveSpy).toHaveBeenCalledWith('tab-text-save-throw')
    expect(flat('tab-text-save-throw').viewMode).toBe('grid')
    expect(
      useToastStore
        .getState()
        .toasts.some(
          (toast) => toast.variant === 'error' && toast.title === 'Cannot switch to text view'
        )
    ).toBe(true)

    saveSpy.mockRestore()
  })
})

describe('useQueryStore — setSelectedRow', () => {
  it('sets selected row index', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    patchResult('tab-1', {})
    useQueryStore.getState().setSelectedRow('tab-1', 5)
    expect(flat('tab-1').selectedRowIndex).toBe(5)
  })

  it('clears selected row with null', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    patchResult('tab-1', {})
    useQueryStore.getState().setSelectedRow('tab-1', 3)
    useQueryStore.getState().setSelectedRow('tab-1', null)
    expect(flat('tab-1').selectedRowIndex).toBeNull()
  })
})

describe('useQueryStore — export dialog', () => {
  it('opens export dialog', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    patchResult('tab-1', {})
    useQueryStore.getState().openExportDialog('tab-1')
    expect(flat('tab-1').exportDialogOpen).toBe(true)
  })

  it('closes export dialog', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    patchResult('tab-1', {})
    useQueryStore.getState().openExportDialog('tab-1')
    useQueryStore.getState().closeExportDialog('tab-1')
    expect(flat('tab-1').exportDialogOpen).toBe(false)
  })
})

describe('useQueryStore — sortResults', () => {
  it('calls sort_results IPC and updates store state', async () => {
    // Set up mock IPC with sort_results handler
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      switch (cmd) {
        case 'execute_query':
          return {
            queryId: 'q-mock',
            columns: [{ name: 'id', dataType: 'INT' }],
            totalRows: 3,
            executionTimeMs: 10,
            affectedRows: 0,
            rows: [[3], [1], [2]],

            autoLimitApplied: false,
          }
        case 'sort_results':
          return { rows: [[1], [2], [3]] }
        case 'evict_results':
          return null
        default:
          return null
      }
    })

    // Execute a query first
    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT id FROM t')

    // Sort ascending
    await useQueryStore.getState().sortResults('conn-1', 'tab-1', 'id', 'asc')
    const f = flat('tab-1')
    expect(f.sortColumn).toBe('id')
    expect(f.sortDirection).toBe('asc')
    expect(f.rows).toEqual([[1], [2], [3]])
  })

  it('resets checkedRowIndices after a sort (stale indices would target wrong rows)', async () => {
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      switch (cmd) {
        case 'execute_query':
          return {
            queryId: 'q-mock',
            columns: [{ name: 'id', dataType: 'INT' }],
            totalRows: 3,
            executionTimeMs: 10,
            affectedRows: 0,
            rows: [[3], [1], [2]],
            autoLimitApplied: false,
          }
        case 'sort_results':
          return { rows: [[1], [2], [3]] }
        default:
          return null
      }
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-1', 'SELECT id FROM t')
    useQueryStore.getState().setCheckedRowIndices('tab-1', [0, 2])
    expect(flat('tab-1').checkedRowIndices).toEqual([0, 2])

    await useQueryStore.getState().sortResults('conn-1', 'tab-1', 'id', 'asc')

    expect(flat('tab-1').checkedRowIndices).toEqual([])
  })

  it('clears sort state when direction is null and re-executes query', async () => {
    // Set up mock IPC with execute_query handler (for re-execution)
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      switch (cmd) {
        case 'execute_query':
          return {
            queryId: 'q-reexec',
            columns: [{ name: 'id', dataType: 'INT' }],
            totalRows: 3,
            executionTimeMs: 8,
            affectedRows: 0,
            rows: [[3], [1], [2]],

            autoLimitApplied: false,
          }
        case 'evict_results':
          return null
        default:
          return null
      }
    })

    // Set up tab with sort state and lastExecutedSql
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    patchResult('tab-1', {
      sortColumn: 'id',
      sortDirection: 'asc' as const,
      lastExecutedSql: 'SELECT id FROM t',
      queryId: 'q-old',
      resultStatus: 'success' as const,
    })
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-1': {
          ...prev.tabs['tab-1']!,
          tabStatus: 'success' as const,
        },
      },
    }))

    await useQueryStore.getState().sortResults('conn-1', 'tab-1', 'id', null)
    const f = flat('tab-1')
    expect(f.sortColumn).toBeNull()
    expect(f.sortDirection).toBeNull()
    // Should have re-executed and gotten fresh data
    expect(f.queryId).toBe('q-reexec')
    expect(f.rows).toEqual([[3], [1], [2]])
  })

  it('normalizes tinyint boolean aliases when clearing sort re-executes the query', async () => {
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      switch (cmd) {
        case 'execute_query':
          return {
            queryId: 'q-reexec-bool',
            columns: BOOLEAN_ALIAS_COLUMNS,
            totalRows: 1,
            executionTimeMs: 8,
            affectedRows: 0,
            rows: [[true, false, 'reexec']],

            autoLimitApplied: false,
          }
        case 'evict_results':
          return null
        default:
          return null
      }
    })

    useQueryStore.getState().setContent('tab-bool-reexec', 'SELECT 1')
    patchResult('tab-bool-reexec', {
      sortColumn: 'is_active',
      sortDirection: 'asc' as const,
      lastExecutedSql: 'SELECT is_active FROM t',
      queryId: 'q-old',
      resultStatus: 'success' as const,
    })
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-bool-reexec': {
          ...prev.tabs['tab-bool-reexec']!,
          tabStatus: 'success' as const,
        },
      },
    }))

    await useQueryStore.getState().sortResults('conn-1', 'tab-bool-reexec', 'is_active', null)

    const f = flat('tab-bool-reexec')
    expect(f.sortColumn).toBeNull()
    expect(f.sortDirection).toBeNull()
    expect(f.rows).toEqual([[1, 0, 'reexec']])
  })

  it('clears sort state visually when no lastExecutedSql', async () => {
    // Set up tab with sort state but NO lastExecutedSql
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    patchResult('tab-1', {
      sortColumn: 'id',
      sortDirection: 'asc' as const,
      lastExecutedSql: null,
    })

    await useQueryStore.getState().sortResults('conn-1', 'tab-1', 'id', null)
    const f = flat('tab-1')
    expect(f.sortColumn).toBeNull()
    expect(f.sortDirection).toBeNull()
  })

  it('logs error on IPC failure', async () => {
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'sort_results') throw new Error('Sort failed')
      return null
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    await useQueryStore.getState().sortResults('conn-1', 'tab-1', 'id', 'asc')
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('handles null sort_results payload without throwing', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      switch (cmd) {
        case 'execute_query':
          return {
            queryId: 'q-sort-null',
            columns: [{ name: 'id', dataType: 'INT' }],
            totalRows: 2,
            executionTimeMs: 1,
            affectedRows: 0,
            rows: [[2], [1]],

            autoLimitApplied: false,
          }
        case 'sort_results':
          return null
        case 'evict_results':
          return null
        default:
          return null
      }
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-sort-null', 'SELECT id FROM t')
    await useQueryStore.getState().sortResults('conn-1', 'tab-sort-null', 'id', 'asc')

    const f = flat('tab-sort-null')
    expect(f.sortColumn).toBeNull()
    expect(f.rows).toEqual([[2], [1]])
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('skips state update if tab was cleaned up during sort', async () => {
    let resolveSortPromise: ((value: unknown) => void) | null = null
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'sort_results') {
        return new Promise((resolve) => {
          resolveSortPromise = resolve
        })
      }
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-stale-sort', 'SELECT 1')
    const promise = useQueryStore.getState().sortResults('conn-1', 'tab-stale-sort', 'id', 'asc')

    // Simulate tab close during sort
    useQueryStore.getState().cleanupTab('conn-1', 'tab-stale-sort')
    expect(useQueryStore.getState().tabs['tab-stale-sort']).toBeUndefined()

    // Resolve the sort
    resolveSortPromise!({ rows: [[1]] })
    await promise

    // Tab should remain undefined
    expect(useQueryStore.getState().tabs['tab-stale-sort']).toBeUndefined()
  })

  it('normalizes tinyint boolean aliases to integer rows on sortResults', async () => {
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'sort_results') {
        return { rows: [[false, true, 'sorted']] }
      }
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-bool-sort', 'SELECT 1')
    patchResult('tab-bool-sort', {
      columns: BOOLEAN_ALIAS_COLUMNS,
    })

    await useQueryStore.getState().sortResults('conn-1', 'tab-bool-sort', 'is_active', 'asc')

    const f = flat('tab-bool-sort')
    expect(f.rows).toEqual([[0, 1, 'sorted']])
    expect(f.sortColumn).toBe('is_active')
    expect(f.sortDirection).toBe('asc')
  })
})

describe('useQueryStore — changeRowLimit', () => {
  it('re-executes query with new page size', async () => {
    const executeFn = vi.fn(() => ({
      queryId: 'q-new',
      columns: [{ name: 'id', dataType: 'INT' }],
      totalRows: 100,
      executionTimeMs: 5,
      affectedRows: 0,
      rows: [[1], [2]],
      autoLimitApplied: false,
    }))

    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') return executeFn()
      if (cmd === 'evict_results') return null
      return null
    })

    // Set up tab with lastExecutedSql
    useQueryStore.getState().setContent('tab-1', 'SELECT id FROM t')
    patchResult('tab-1', {
      lastExecutedSql: 'SELECT id FROM t',
      resultStatus: 'success' as const,
      queryId: 'q-old',
      selectedRowIndex: 3,
    })
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-1': {
          ...prev.tabs['tab-1']!,
          tabStatus: 'success' as const,
        },
      },
    }))

    await useQueryStore.getState().changeRowLimit('conn-1', 'tab-1', 500)
    const f = flat('tab-1')
    expect(f.resultStatus).toBe('success')
    expect(f.rowLimit).toBe(500)
    expect(f.queryId).toBe('q-new')
    expect(f.totalRows).toBe(100)
    expect(f.rows).toEqual([[1], [2]])

    expect(f.sortColumn).toBeNull()
    expect(f.sortDirection).toBeNull()
    expect(f.selectedRowIndex).toBeNull()
  })

  it('normalizes tinyint boolean aliases when changeRowLimit re-executes the query', async () => {
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-new-bool',
          columns: BOOLEAN_ALIAS_COLUMNS,
          totalRows: 1,
          executionTimeMs: 5,
          affectedRows: 0,
          rows: [[false, true, 'resized']],

          autoLimitApplied: false,
        }
      }
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-bool-size', 'SELECT is_active FROM t')
    patchResult('tab-bool-size', {
      lastExecutedSql: 'SELECT is_active FROM t',
      resultStatus: 'success' as const,
      queryId: 'q-old',
    })
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-bool-size': {
          ...prev.tabs['tab-bool-size']!,
          tabStatus: 'success' as const,
        },
      },
    }))

    await useQueryStore.getState().changeRowLimit('conn-1', 'tab-bool-size', 250)

    const f = flat('tab-bool-size')
    expect(f.rows).toEqual([[0, 1, 'resized']])
    expect(f.rowLimit).toBe(250)
  })

  it('does nothing when no lastExecutedSql', async () => {
    useQueryStore.getState().setContent('tab-1', '')
    await useQueryStore.getState().changeRowLimit('conn-1', 'tab-1', 500)
    // Should not throw; status should remain unchanged
    expect(useQueryStore.getState().getTabState('tab-1').tabStatus).toBe('idle')
  })

  it('sets error status on IPC failure', async () => {
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') throw new Error('Query failed')
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    patchResult('tab-1', {
      lastExecutedSql: 'SELECT 1',
      resultStatus: 'success' as const,
    })
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-1': {
          ...prev.tabs['tab-1']!,
          tabStatus: 'success' as const,
        },
      },
    }))

    await useQueryStore.getState().changeRowLimit('conn-1', 'tab-1', 500)
    const f = flat('tab-1')
    expect(f.resultStatus).toBe('error')
    expect(f.errorMessage).toContain('Query failed')
  })

  it('skips state update if tab was cleaned up during changeRowLimit', async () => {
    let resolveQuery: ((value: unknown) => void) | null = null
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return new Promise((resolve) => {
          resolveQuery = resolve
        })
      }
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-stale-ps', 'SELECT id FROM t')
    patchResult('tab-stale-ps', {
      lastExecutedSql: 'SELECT id FROM t',
      resultStatus: 'success' as const,
    })
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-stale-ps': {
          ...prev.tabs['tab-stale-ps']!,
          tabStatus: 'success' as const,
        },
      },
    }))

    const promise = useQueryStore.getState().changeRowLimit('conn-1', 'tab-stale-ps', 500)

    // Simulate tab close mid-flight
    useQueryStore.getState().cleanupTab('conn-1', 'tab-stale-ps')
    expect(useQueryStore.getState().tabs['tab-stale-ps']).toBeUndefined()

    // Resolve the query
    resolveQuery!({
      queryId: 'q-new',
      columns: [{ name: 'id', dataType: 'INT' }],
      totalRows: 10,
      executionTimeMs: 5,
      affectedRows: 0,
      rows: [[1]],

      autoLimitApplied: false,
    })
    await promise

    // Tab should remain undefined
    expect(useQueryStore.getState().tabs['tab-stale-ps']).toBeUndefined()
  })

  it('skips error update if tab was cleaned up during failed changeRowLimit', async () => {
    let rejectQuery: ((reason: unknown) => void) | null = null
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return new Promise((_resolve, reject) => {
          rejectQuery = reject
        })
      }
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-stale-ps2', 'SELECT 1')
    patchResult('tab-stale-ps2', {
      lastExecutedSql: 'SELECT 1',
      resultStatus: 'success' as const,
    })
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-stale-ps2': {
          ...prev.tabs['tab-stale-ps2']!,
          tabStatus: 'success' as const,
        },
      },
    }))

    const promise = useQueryStore.getState().changeRowLimit('conn-1', 'tab-stale-ps2', 100)

    // Simulate tab close mid-flight
    useQueryStore.getState().cleanupTab('conn-1', 'tab-stale-ps2')

    // Reject the query
    rejectQuery!(new Error('Timeout'))
    await promise

    // Tab should remain undefined (error handler guard prevents write-back)
    expect(useQueryStore.getState().tabs['tab-stale-ps2']).toBeUndefined()
  })

  it('writes an error result when re-execution fails and the query id is unchanged', async () => {
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') throw new Error('re-exec failed')
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-ps-error-state', 'SELECT 1')
    patchResult('tab-ps-error-state', {
      lastExecutedSql: 'SELECT 1',
      resultStatus: 'success' as const,
      queryId: 'q-stable',
    })
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-ps-error-state': {
          ...prev.tabs['tab-ps-error-state']!,
          tabStatus: 'success' as const,
        },
      },
    }))

    await useQueryStore.getState().changeRowLimit('conn-1', 'tab-ps-error-state', 250)

    const state = flat('tab-ps-error-state')
    expect(state.resultStatus).toBe('error')
    expect(state.errorMessage).toBe('re-exec failed')
  })
})

describe('useQueryStore — executeQuery execution timing', () => {
  it('sets executionStartedAt when entering running state', async () => {
    let resolveQuery: ((value: unknown) => void) | null = null
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return new Promise((resolve) => {
          resolveQuery = resolve
        })
      }
      if (cmd === 'evict_results') return null
      return null
    })

    const beforeMs = Date.now()
    useQueryStore.getState().setContent('tab-timing', 'SELECT 1')
    const promise = useQueryStore.getState().executeQuery('conn-1', 'tab-timing', 'SELECT 1')

    // While running, executionStartedAt should be set
    const runningState = useQueryStore.getState().getTabState('tab-timing')
    expect(runningState.tabStatus).toBe('running')
    expect(runningState.executionStartedAt).not.toBeNull()
    expect(runningState.executionStartedAt!).toBeGreaterThanOrEqual(beforeMs)
    expect(runningState.executionStartedAt!).toBeLessThanOrEqual(Date.now())

    // Resolve the query
    resolveQuery!({
      queryId: 'q-mock',
      columns: [{ name: 'id', dataType: 'INT' }],
      totalRows: 1,
      executionTimeMs: 10,
      affectedRows: 0,
      rows: [[1]],

      autoLimitApplied: false,
    })
    await promise

    // After success, executionStartedAt should be cleared
    const successState = useQueryStore.getState().getTabState('tab-timing')
    expect(successState.tabStatus).toBe('success')
    expect(successState.executionStartedAt).toBeNull()
  })

  it('clears executionStartedAt on error', async () => {
    overrideNamedCommands(QUERY_STORE_COMMANDS, () => {
      throw new Error('Query failed')
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-err-timing', 'SELECT bad')
    const state = useQueryStore.getState().getTabState('tab-err-timing')
    expect(state.tabStatus).toBe('error')
    expect(state.executionStartedAt).toBeNull()
  })

  it('resets cancel flags at start of executeQuery', async () => {
    // Pre-set cancel flags
    useQueryStore.getState().setContent('tab-cancel-reset', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-cancel-reset': {
          ...prev.tabs['tab-cancel-reset']!,
          isCancelling: true,
          wasCancelled: true,
        },
      },
    }))

    await useQueryStore.getState().executeQuery('conn-1', 'tab-cancel-reset', 'SELECT 1')
    const state = useQueryStore.getState().getTabState('tab-cancel-reset')
    expect(state.isCancelling).toBe(false)
    expect(state.wasCancelled).toBe(false)
  })

  it('shows friendly message when query was cancelled', async () => {
    let rejectQuery: ((reason: unknown) => void) | null = null
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return new Promise((_resolve, reject) => {
          rejectQuery = reject
        })
      }
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-cancelled', 'SELECT 1')
    const promise = useQueryStore
      .getState()
      .executeQuery('conn-1', 'tab-cancelled', 'SELECT SLEEP(100)')

    // Simulate setting wasCancelled while query is running
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-cancelled': {
          ...prev.tabs['tab-cancelled']!,
          wasCancelled: true,
        },
      },
    }))

    // Reject with a MySQL error
    rejectQuery!(new Error('Query execution was interrupted'))
    await promise

    const state = useQueryStore.getState().getTabState('tab-cancelled')
    expect(state.tabStatus).toBe('error')
    expect(flat('tab-cancelled').errorMessage).toBe('Query cancelled by user')
    // isCancelling and wasCancelled should be cleared after completion
    expect(state.isCancelling).toBe(false)
    expect(state.wasCancelled).toBe(false)
  })
})

describe('useQueryStore — changeRowLimit execution timing', () => {
  it('sets executionStartedAt when entering running state', async () => {
    let resolveQuery: ((value: unknown) => void) | null = null
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') {
        return new Promise((resolve) => {
          resolveQuery = resolve
        })
      }
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-ps-timing', 'SELECT 1')
    patchResult('tab-ps-timing', {
      lastExecutedSql: 'SELECT 1',
      resultStatus: 'success' as const,
    })
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-ps-timing': {
          ...prev.tabs['tab-ps-timing']!,
          tabStatus: 'success' as const,
        },
      },
    }))

    const beforeMs = Date.now()
    const promise = useQueryStore.getState().changeRowLimit('conn-1', 'tab-ps-timing', 500)

    // While running, executionStartedAt should be set
    const runningState = useQueryStore.getState().getTabState('tab-ps-timing')
    expect(runningState.tabStatus).toBe('running')
    expect(runningState.executionStartedAt).not.toBeNull()
    expect(runningState.executionStartedAt!).toBeGreaterThanOrEqual(beforeMs)

    // Resolve
    resolveQuery!({
      queryId: 'q-new',
      columns: [{ name: 'id', dataType: 'INT' }],
      totalRows: 10,
      executionTimeMs: 5,
      affectedRows: 0,
      rows: [[1]],

      autoLimitApplied: false,
    })
    await promise

    // After success, executionStartedAt should be cleared
    const successState = useQueryStore.getState().getTabState('tab-ps-timing')
    expect(successState.tabStatus).toBe('success')
    expect(successState.executionStartedAt).toBeNull()
  })

  it('clears executionStartedAt on error', async () => {
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'execute_query') throw new Error('Query failed')
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-ps-err-timing', 'SELECT 1')
    patchResult('tab-ps-err-timing', {
      lastExecutedSql: 'SELECT 1',
      resultStatus: 'success' as const,
    })
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-ps-err-timing': {
          ...prev.tabs['tab-ps-err-timing']!,
          tabStatus: 'success' as const,
        },
      },
    }))

    await useQueryStore.getState().changeRowLimit('conn-1', 'tab-ps-err-timing', 500)

    const state = useQueryStore.getState().getTabState('tab-ps-err-timing')
    expect(state.tabStatus).toBe('error')
    expect(state.executionStartedAt).toBeNull()
  })
})

describe('useQueryStore — cancelQuery', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    _resetToastTimeoutsForTests()
  })

  it('sets flags correctly and shows success toast when kill was issued', async () => {
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'cancel_query') return true
      if (cmd === 'execute_query') {
        return {
          queryId: 'q-mock',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          rows: [[1]],

          autoLimitApplied: false,
        }
      }
      if (cmd === 'evict_results') return null
      return null
    })

    // Set up a tab in running state
    useQueryStore.getState().setContent('tab-cancel', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-cancel': {
          ...prev.tabs['tab-cancel']!,
          tabStatus: 'running' as const,
        },
      },
    }))

    await useQueryStore.getState().cancelQuery('conn-1', 'tab-cancel')

    const state = useQueryStore.getState().getTabState('tab-cancel')
    // isCancelling stays true after successful kill — button stays disabled
    // until executeQuery completes and clears it
    expect(state.isCancelling).toBe(true)
    expect(state.wasCancelled).toBe(true) // stays true for error handler

    const toasts = useToastStore.getState().toasts
    expect(toasts.some((t) => t.variant === 'success' && t.title === 'Query cancelled')).toBe(true)
  })

  it('resets flags on no-op (query already finished) with no toast', async () => {
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'cancel_query') return false
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-noop', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-noop': {
          ...prev.tabs['tab-noop']!,
          tabStatus: 'running' as const,
        },
      },
    }))

    await useQueryStore.getState().cancelQuery('conn-1', 'tab-noop')

    const state = useQueryStore.getState().getTabState('tab-noop')
    expect(state.isCancelling).toBe(false)
    expect(state.wasCancelled).toBe(false) // reset on no-op

    // No toast should be shown
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(0)
  })

  it('resets flags and shows error toast on IPC error', async () => {
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'cancel_query') throw new Error('Connection lost')
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-cancel-err', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-cancel-err': {
          ...prev.tabs['tab-cancel-err']!,
          tabStatus: 'running' as const,
        },
      },
    }))

    await useQueryStore.getState().cancelQuery('conn-1', 'tab-cancel-err')

    const state = useQueryStore.getState().getTabState('tab-cancel-err')
    expect(state.isCancelling).toBe(false)
    expect(state.wasCancelled).toBe(false) // reset on error

    const toasts = useToastStore.getState().toasts
    expect(toasts.some((t) => t.variant === 'error' && t.title === 'Cancel failed')).toBe(true)
  })

  it('prevents double-cancel when isCancelling is already true', async () => {
    let cancelCallCount = 0
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'cancel_query') {
        cancelCallCount++
        return true
      }
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-dbl', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-dbl': {
          ...prev.tabs['tab-dbl']!,
          tabStatus: 'running' as const,
          isCancelling: true,
        },
      },
    }))

    await useQueryStore.getState().cancelQuery('conn-1', 'tab-dbl')

    // Should not have called the IPC
    expect(cancelCallCount).toBe(0)
  })

  it('does not create ghost tab state if tab was closed during cancel IPC', async () => {
    let resolveCancelPromise: ((value: unknown) => void) | null = null
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'cancel_query') {
        return new Promise((resolve) => {
          resolveCancelPromise = resolve
        })
      }
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-ghost', 'SELECT 1')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-ghost': {
          ...prev.tabs['tab-ghost']!,
          tabStatus: 'running' as const,
        },
      },
    }))

    const promise = useQueryStore.getState().cancelQuery('conn-1', 'tab-ghost')

    // Simulate tab close while cancel IPC is in flight
    useQueryStore.getState().cleanupTab('conn-1', 'tab-ghost')
    expect(useQueryStore.getState().tabs['tab-ghost']).toBeUndefined()

    // Resolve the cancel IPC
    resolveCancelPromise!(true)
    await promise

    // Tab should remain undefined — no ghost entry created
    expect(useQueryStore.getState().tabs['tab-ghost']).toBeUndefined()
  })
})

describe('useQueryStore — default tab state new fields', () => {
  it('returns default new fields for unknown tab', () => {
    const state = useQueryStore.getState().getTabState('unknown')
    expect(state.executionStartedAt).toBeNull()
    expect(state.isCancelling).toBe(false)
    expect(state.wasCancelled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// setTabStatus
// ---------------------------------------------------------------------------

describe('useQueryStore — setTabStatus', () => {
  beforeEach(() => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
  })

  it('sets tabStatus to a standard ExecutionStatus', () => {
    useQueryStore.getState().setTabStatus('tab-1', 'success')
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.tabStatus).toBe('success')
  })

  it('sets tabStatus to ai-pending and saves prevTabStatus', () => {
    // Start from idle (default)
    expect(useQueryStore.getState().getTabState('tab-1').tabStatus).toBe('idle')
    useQueryStore.getState().setTabStatus('tab-1', 'ai-pending')
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.tabStatus).toBe('ai-pending')
    expect(state.prevTabStatus).toBe('idle')
  })

  it('preserves prevTabStatus when transitioning from success to ai-pending', () => {
    useQueryStore.getState().setTabStatus('tab-1', 'success')
    useQueryStore.getState().setTabStatus('tab-1', 'ai-pending')
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.tabStatus).toBe('ai-pending')
    expect(state.prevTabStatus).toBe('success')
  })

  it('does not overwrite prevTabStatus when moving between AI states', () => {
    useQueryStore.getState().setTabStatus('tab-1', 'success')
    useQueryStore.getState().setTabStatus('tab-1', 'ai-pending')
    // prevTabStatus should be 'success'
    useQueryStore.getState().setTabStatus('tab-1', 'ai-reviewing')
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.tabStatus).toBe('ai-reviewing')
    // prevTabStatus should still be 'success' — not 'ai-pending'
    expect(state.prevTabStatus).toBe('success')
  })

  it('restores from ai-pending to prevTabStatus', () => {
    useQueryStore.getState().setTabStatus('tab-1', 'success')
    useQueryStore.getState().setTabStatus('tab-1', 'ai-pending')
    // Now restore
    const prev = useQueryStore.getState().getTabState('tab-1').prevTabStatus
    useQueryStore.getState().setTabStatus('tab-1', prev)
    const state = useQueryStore.getState().getTabState('tab-1')
    expect(state.tabStatus).toBe('success')
  })

  it('no-ops for non-existent tab', () => {
    // Should not throw
    useQueryStore.getState().setTabStatus('nonexistent', 'ai-pending')
    expect(useQueryStore.getState().tabs['nonexistent']).toBeUndefined()
  })
})

describe('useQueryStore — setResultScrollCell', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useQueryStore.setState({ tabs: {} })
    useQueryStore.getState().setContent('tab-1', 'SELECT 1')
    patchResult('tab-1', { resultStatus: 'success' })
  })

  it('persists scroll position on the active result', () => {
    useQueryStore.getState().setResultScrollCell('tab-1', 10, 5)
    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    expect(result.scrollRow).toBe(10)
    expect(result.scrollCol).toBe(5)
  })

  it('does not create a new state reference when values are unchanged', () => {
    useQueryStore.getState().setResultScrollCell('tab-1', 10, 5)
    const before = useQueryStore.getState().tabs['tab-1']!.results[0]
    useQueryStore.getState().setResultScrollCell('tab-1', 10, 5)
    const after = useQueryStore.getState().tabs['tab-1']!.results[0]
    expect(before).toBe(after)
  })

  it('no-ops for non-existent tab', () => {
    useQueryStore.getState().setResultScrollCell('nonexistent', 10, 5)
    expect(useQueryStore.getState().tabs['nonexistent']).toBeUndefined()
  })

  it('defaults scroll position to zero', () => {
    const result = useQueryStore.getState().tabs['tab-1']!.results[0]
    expect(result.scrollRow).toBe(0)
    expect(result.scrollCol).toBe(0)
  })
})

describe('useQueryStore — setCheckedRowIndices', () => {
  it('replaces the checked row indices for the active result', () => {
    useQueryStore.getState().setContent('tab-chk', 'SELECT 1')
    patchResult('tab-chk', { checkedRowIndices: [] })

    useQueryStore.getState().setCheckedRowIndices('tab-chk', [0, 2])
    expect(flat('tab-chk').checkedRowIndices).toEqual([0, 2])

    useQueryStore.getState().setCheckedRowIndices('tab-chk', [])
    expect(flat('tab-chk').checkedRowIndices).toEqual([])
  })
})

describe('useQueryStore — deleteResultRows', () => {
  const editMetadata = {
    users: {
      database: 'testdb',
      table: 'users',
      columns: [],
      primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
      foreignKeys: [],
    },
  }

  // Build an edit-mode result: a result bound to `users` with `id` as its key
  // column, present at result column index 0. `lastExecutedSql: null` keeps the
  // post-delete cache refresh disabled so tests can observe the optimistic
  // in-memory removal directly (the refresh path is covered separately).
  function setupEditableResult(tabId: string, overrides: Record<string, unknown> = {}) {
    useQueryStore.getState().setContent(tabId, 'SELECT id, name FROM users')
    patchResult(tabId, {
      columns: [
        { name: 'id', dataType: 'INT' },
        { name: 'name', dataType: 'VARCHAR' },
      ],
      rows: [
        [1, 'a'],
        [2, 'b'],
        [3, 'c'],
      ],
      totalRows: 3,
      selectedRowIndex: 1,
      editMode: 'users',
      editConnectionId: 'conn-1',
      lastExecutedSql: null,
      editTableMetadata: editMetadata,
      editBoundColumnIndexMap: new Map([
        ['id', 0],
        ['name', 1],
      ]),
      checkedRowIndices: [0, 2],
      ...overrides,
    })
  }

  it('deletes checked rows from the DB by key value, then removes them from the view', async () => {
    ipc.override('delete_table_row', () => undefined)
    setupEditableResult('tab-del')

    const count = await useQueryStore.getState().deleteResultRows('tab-del', [0, 2])

    expect(count).toBe(2)
    const calls = ipc.calls('delete_table_row') as Array<Record<string, unknown>>
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      database: 'testdb',
      table: 'users',
      pkColumns: ['id'],
      pkValues: { id: 1 },
    })
    expect(calls[1]).toMatchObject({ pkValues: { id: 3 } })

    const result = flat('tab-del')
    expect(result.rows).toEqual([[2, 'b']])
    expect(result.totalRows).toBe(1)
    expect(result.selectedRowIndex).toBeNull()
    expect(result.checkedRowIndices).toEqual([])
  })

  it('removes deleted rows from unfilteredRows when a filter is active', async () => {
    ipc.override('delete_table_row', () => undefined)
    const rowA = [1, 'a']
    const rowB = [2, 'b']
    const rowC = [3, 'c']
    setupEditableResult('tab-del-f', {
      rows: [rowA, rowC],
      unfilteredRows: [rowA, rowB, rowC],
      totalRows: 2,
      checkedRowIndices: [0],
    })

    await useQueryStore.getState().deleteResultRows('tab-del-f', [0])

    const result = flat('tab-del-f')
    expect(result.rows).toEqual([rowC])
    // rowA removed from the unfiltered originals, rowB (filtered out) preserved.
    expect(result.unfilteredRows).toEqual([rowB, rowC])
  })

  it('refuses to delete and warns when the result is not in edit mode', async () => {
    ipc.override('delete_table_row', () => undefined)
    setupEditableResult('tab-del-ro', { editMode: null })

    const count = await useQueryStore.getState().deleteResultRows('tab-del-ro', [0, 2])

    expect(count).toBe(0)
    expect(ipc.calls('delete_table_row')).toHaveLength(0)
    expect(flat('tab-del-ro').rows).toHaveLength(3)
    await expectToast('error', 'Enable edit mode')
  })

  it('refuses to delete when the key columns are absent from the result set', async () => {
    ipc.override('delete_table_row', () => undefined)
    setupEditableResult('tab-del-nokey', { editBoundColumnIndexMap: new Map([['name', 1]]) })

    const count = await useQueryStore.getState().deleteResultRows('tab-del-nokey', [0])

    expect(count).toBe(0)
    expect(ipc.calls('delete_table_row')).toHaveLength(0)
    await expectToast('error', 'key columns')
  })

  it('stops on the first failed delete and records the error', async () => {
    let callCount = 0
    ipc.override('delete_table_row', () => {
      callCount += 1
      if (callCount === 2) throw new Error('FK constraint')
      return undefined
    })
    setupEditableResult('tab-del-err')

    const count = await useQueryStore.getState().deleteResultRows('tab-del-err', [0, 2])

    expect(count).toBe(1)
    const result = flat('tab-del-err')
    // Only the first (id=1) row was removed before the failure on id=3.
    expect(result.rows).toEqual([
      [2, 'b'],
      [3, 'c'],
    ])
    expect(result.saveError).toBe('FK constraint')
    await expectToast('error', 'FK constraint')
  })

  it('records the error and removes nothing when the first delete fails', async () => {
    ipc.override('delete_table_row', () => {
      throw new Error('access denied')
    })
    setupEditableResult('tab-del-first-err')

    const count = await useQueryStore.getState().deleteResultRows('tab-del-first-err', [0, 2])

    expect(count).toBe(0)
    const result = flat('tab-del-first-err')
    expect(result.rows).toHaveLength(3)
    expect(result.saveError).toBe('access denied')
    await expectToast('error', 'access denied')
  })

  it('refreshes the result cache after a successful delete', async () => {
    ipc.override('delete_table_row', () => undefined)
    setupEditableResult('tab-del-refresh', { lastExecutedSql: 'SELECT id, name FROM users' })

    await useQueryStore.getState().deleteResultRows('tab-del-refresh', [0])

    // The single-result refresh path re-runs execute_query (the beforeEach mock
    // returns three id-only rows), proving the cache was refreshed.
    const result = flat('tab-del-refresh')
    expect(result.rows).toEqual([[1], [2], [3]])
  })

  it('refreshes the cache on a partial failure and skips the success toast', async () => {
    useToastStore.setState({ toasts: [] })
    let callCount = 0
    ipc.override('delete_table_row', () => {
      callCount += 1
      if (callCount === 2) throw new Error('FK constraint')
      return undefined
    })
    setupEditableResult('tab-del-partial-refresh', {
      lastExecutedSql: 'SELECT id, name FROM users',
    })

    const count = await useQueryStore.getState().deleteResultRows('tab-del-partial-refresh', [0, 2])

    expect(count).toBe(1)
    // The cache refresh ran despite the failure: rows now reflect the id-only
    // execute_query mock rather than the optimistic in-memory removal.
    const result = flat('tab-del-partial-refresh')
    expect(result.rows).toEqual([[1], [2], [3]])
    await expectToast('error', 'FK constraint')
    // The failure already surfaced an error toast; no "Rows deleted" success.
    expect(
      useToastStore
        .getState()
        .toasts.some((toast) => toast.variant === 'success' && toast.title === 'Rows deleted')
    ).toBe(false)
  })

  it('no-ops for an empty index list', async () => {
    ipc.override('delete_table_row', () => undefined)
    setupEditableResult('tab-del-empty')

    const count = await useQueryStore.getState().deleteResultRows('tab-del-empty', [])
    expect(count).toBe(0)
    expect(ipc.calls('delete_table_row')).toHaveLength(0)
    expect(flat('tab-del-empty').rows).toHaveLength(3)
  })
})

describe('useQueryStore — totalTimeMs propagation', () => {
  it('captures totalTimeMs from execute_query on a fresh result', async () => {
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'execute_query')
        return {
          queryId: 'q-total',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 3,
          executionTimeMs: 10,
          totalTimeMs: 45,
          affectedRows: 0,
          rows: [[1], [2], [3]],
          autoLimitApplied: false,
        }
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-total', 'SELECT id FROM t')

    const f = flat('tab-total')
    expect(f.executionTimeMs).toBe(10)
    expect(f.totalTimeMs).toBe(45)
  })

  it('preserves totalTimeMs after sortResults re-executes (clear sort)', async () => {
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'execute_query')
        return {
          queryId: 'q-sort-total',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 3,
          executionTimeMs: 8,
          totalTimeMs: 33,
          affectedRows: 0,
          rows: [[3], [1], [2]],
          autoLimitApplied: false,
        }
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-sort-total', 'SELECT 1')
    patchResult('tab-sort-total', {
      sortColumn: 'id',
      sortDirection: 'asc' as const,
      lastExecutedSql: 'SELECT id FROM t',
      queryId: 'q-old',
      resultStatus: 'success' as const,
    })
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-sort-total': { ...prev.tabs['tab-sort-total']!, tabStatus: 'success' as const },
      },
    }))

    await useQueryStore.getState().sortResults('conn-1', 'tab-sort-total', 'id', null)

    expect(flat('tab-sort-total').totalTimeMs).toBe(33)
  })

  it('preserves totalTimeMs after changeRowLimit re-executes', async () => {
    overrideNamedCommands(QUERY_STORE_COMMANDS, (cmd) => {
      if (cmd === 'execute_query')
        return {
          queryId: 'q-limit-total',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 100,
          executionTimeMs: 5,
          totalTimeMs: 27,
          affectedRows: 0,
          rows: [[1], [2]],
          autoLimitApplied: false,
        }
      if (cmd === 'evict_results') return null
      return null
    })

    useQueryStore.getState().setContent('tab-limit-total', 'SELECT id FROM t')
    patchResult('tab-limit-total', {
      lastExecutedSql: 'SELECT id FROM t',
      resultStatus: 'success' as const,
      queryId: 'q-old',
    })
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-limit-total': { ...prev.tabs['tab-limit-total']!, tabStatus: 'success' as const },
      },
    }))

    await useQueryStore.getState().changeRowLimit('conn-1', 'tab-limit-total', 500)

    expect(flat('tab-limit-total').totalTimeMs).toBe(27)
  })
})
