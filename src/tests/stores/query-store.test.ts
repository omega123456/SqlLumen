import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ipc, expectToast, overrideIpcCommands, overrideNamedIpcCommands } from '../ipc-mock'
import {
  useQueryStore,
  DEFAULT_RESULT_STATE,
  RESULT_EXPORT_POLL_MS,
  countRanges,
} from '../../stores/query-store'
import { useToastStore, _resetToastTimeoutsForTests } from '../../stores/toast-store'
import { useTableDataStore } from '../../stores/table-data-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { resetWorkspaceStore } from '../helpers/workspace-test-utils'
import {
  baseIndicesOf,
  flat,
  firstWindowFor,
  makeTabState,
  withRows,
} from '../helpers/query-test-utils'
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
] as const

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  resetWorkspaceStore()
  useTableDataStore.setState({ tabs: {} })
  overrideCommands({
    execute_query: () => ({
      queryId: 'q-mock',
      columns: [{ name: 'id', dataType: 'INT' }],
      totalRows: 3,
      executionTimeMs: 10,
      affectedRows: 0,
      firstWindow: firstWindowFor([[1], [2], [3]]),

      autoLimitApplied: false,
    }),
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
    resetWorkspaceStore({ visibleConnectionSessionId: 'conn-1' })
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
    resetWorkspaceStore()
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
    resetWorkspaceStore()
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
    resetWorkspaceStore({ visibleConnectionSessionId: 'conn-1' })
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
        firstWindow: firstWindowFor([[true, false, 'flagged']]),

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
        firstWindow: firstWindowFor([['\u0001', '\u0000', 'flagged']]),

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
        firstWindow: firstWindowFor([[1]]),

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
          firstWindow: firstWindowFor([[1]]),

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
            firstWindow: firstWindowFor([[1]]),
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
            firstWindow: firstWindowFor([['alice']]),
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
      firstWindow: firstWindowFor([[1]]),

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
      ...withRows([[1]]),
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
      ...withRows([[1]]),
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
  function seedSortable(tabId: string) {
    useQueryStore.getState().setContent(tabId, 'SELECT id FROM t')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        [tabId]: {
          ...prev.tabs[tabId]!,
          connectionId: 'conn-1',
          tabStatus: 'success',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              columns: [{ name: 'id', dataType: 'INT' }],
              queryId: 'q-sort',
              totalRows: 3,
              viewVersion: 1,
              latestKnownViewVersion: 1,
              lastExecutedSql: 'SELECT id FROM t',
              checkedRanges: [[0, 2]],
              checkedViewVersion: 1,
              ...withRows([[3], [1], [2]]),
            },
          ],
        },
      },
    }))
  }

  it('sorts through set_result_view and paints the sorted first window', async () => {
    seedSortable('tab-1')
    ipc.override('set_result_view', () => ({
      viewVersion: 2,
      viewRowCount: 3,
      totalRows: 3,
      firstWindow: { offset: 0, rows: [[1], [2], [3]], baseIndices: [1, 2, 0] },
    }))

    await useQueryStore.getState().sortResults('conn-1', 'tab-1', 'id', 'asc')

    expect(ipc.calls('set_result_view')[0]).toMatchObject({
      queryId: 'q-sort',
      baseViewVersion: 1,
      viewSpec: { sort: { column: 'id', direction: 'asc' }, filters: [] },
    })
    const f = flat('tab-1')
    expect(f.sortColumn).toBe('id')
    expect(f.sortDirection).toBe('asc')
    expect(f.rows).toEqual([[1], [2], [3]])
    expect(baseIndicesOf('tab-1')).toEqual([1, 2, 0])
    // Checked ranges belong to the old view and are cleared.
    expect(f.checkedRanges).toEqual([])
    expect(ipc.calls('sort_results')).toHaveLength(0)
  })

  it('clearing the sort restores base order in Rust with no execute command', async () => {
    seedSortable('tab-1')
    ipc.override('set_result_view', () => ({
      viewVersion: 3,
      viewRowCount: 3,
      totalRows: 3,
      firstWindow: { offset: 0, rows: [[3], [1], [2]], baseIndices: [0, 1, 2] },
    }))

    await useQueryStore.getState().sortResults('conn-1', 'tab-1', 'id', null)

    expect(ipc.calls('set_result_view')[0]).toMatchObject({ viewSpec: { sort: null, filters: [] } })
    expect(ipc.calls('execute_query')).toHaveLength(0)
    expect(ipc.calls('reexecute_single_result')).toHaveLength(0)
    const f = flat('tab-1')
    expect(f.sortColumn).toBeNull()
    expect(f.sortDirection).toBeNull()
    expect(f.rows).toEqual([[3], [1], [2]])
  })

  it('normalizes tinyint boolean aliases in the sorted window', async () => {
    useQueryStore.getState().setContent('tab-bool', 'SELECT * FROM flags')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        'tab-bool': {
          ...prev.tabs['tab-bool']!,
          connectionId: 'conn-1',
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              columns: BOOLEAN_ALIAS_COLUMNS,
              queryId: 'q-bool',
              totalRows: 1,
              viewVersion: 1,
              ...withRows([[1, 0, 'x']]),
            },
          ],
        },
      },
    }))
    ipc.override('set_result_view', () => ({
      viewVersion: 2,
      viewRowCount: 1,
      totalRows: 1,
      firstWindow: { offset: 0, rows: [[true, false, 'x']], baseIndices: [0] },
    }))

    await useQueryStore.getState().sortResults('conn-1', 'tab-bool', 'label', 'desc')

    expect(flat('tab-bool').rows).toEqual([[1, 0, 'x']])
  })

  it('ignores a sort request for an unknown tab', async () => {
    await useQueryStore.getState().sortResults('conn-1', 'missing', 'id', 'asc')
    expect(ipc.calls('set_result_view')).toHaveLength(0)
  })

  it('skips the state update if the tab was cleaned up during the sort', async () => {
    seedSortable('tab-1')
    let release: (() => void) | undefined
    ipc.override(
      'set_result_view',
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              viewVersion: 2,
              viewRowCount: 3,
              totalRows: 3,
              firstWindow: { offset: 0, rows: [[1], [2], [3]], baseIndices: [1, 2, 0] },
            })
        })
    )
    const sortPromise = useQueryStore.getState().sortResults('conn-1', 'tab-1', 'id', 'asc')
    useQueryStore.getState().cleanupTab('conn-1', 'tab-1')
    release?.()
    await sortPromise
    expect(useQueryStore.getState().tabs['tab-1']).toBeUndefined()
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
      firstWindow: firstWindowFor([[1], [2]]),
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
          firstWindow: firstWindowFor([[false, true, 'resized']]),

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
      firstWindow: firstWindowFor([[1]]),

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
      firstWindow: firstWindowFor([[1]]),

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
      firstWindow: firstWindowFor([[1]]),

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
          firstWindow: firstWindowFor([[1]]),

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

describe('useQueryStore — setCheckedRanges', () => {
  it('stores checked view ranges tagged with the current view version', () => {
    useQueryStore.getState().setContent('tab-chk', 'SELECT 1')
    patchResult('tab-chk', { viewVersion: 4, checkedRanges: [] })

    useQueryStore.getState().setCheckedRanges('tab-chk', [[0, 100_000]])
    expect(flat('tab-chk').checkedRanges).toEqual([[0, 100_000]])
    expect(flat('tab-chk').checkedViewVersion).toBe(4)
    expect(countRanges(flat('tab-chk').checkedRanges)).toBe(100_000)

    useQueryStore.getState().setCheckedRanges('tab-chk', [])
    expect(flat('tab-chk').checkedRanges).toEqual([])
    // Clearing an already-empty set is a no-op.
    useQueryStore.getState().setCheckedRanges('tab-chk', [])
    useQueryStore.getState().setCheckedRanges('missing', [[0, 1]])
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
  const ROWS = [
    [1, 'a'],
    [2, 'b'],
    [3, 'c'],
  ]

  // An edit-mode result bound to `users` with `id` (result column 0) as its key.
  function setupEditableResult(tabId: string, overrides: Record<string, unknown> = {}) {
    useQueryStore.getState().setContent(tabId, 'SELECT id, name FROM users')
    useQueryStore.setState((prev) => ({
      tabs: {
        ...prev.tabs,
        [tabId]: { ...prev.tabs[tabId]!, connectionId: 'conn-1' },
      },
    }))
    patchResult(tabId, {
      columns: [
        { name: 'id', dataType: 'INT' },
        { name: 'name', dataType: 'VARCHAR' },
      ],
      ...withRows(ROWS),
      queryId: 'q-del',
      totalRows: 3,
      viewVersion: 1,
      latestKnownViewVersion: 1,
      selectedRowIndex: 1,
      editMode: 'users',
      editConnectionId: 'conn-1',
      lastExecutedSql: 'SELECT id, name FROM users',
      editTableMetadata: editMetadata,
      editBoundColumnIndexMap: new Map([
        ['id', 0],
        ['name', 1],
      ]),
      checkedRanges: [
        [0, 1],
        [2, 3],
      ],
      checkedViewVersion: 1,
      ...overrides,
    })
  }

  function removedResponse() {
    ipc.override('remove_result_rows', (args) => {
      const removed = (args?.baseIndices as number[]).length
      return { viewVersion: 2, viewRowCount: 3 - removed, totalRows: 3 - removed }
    })
  }

  it('deletes checked rows by key, tombstones exactly those base indices, and never re-runs', async () => {
    ipc.override('delete_table_row', () => undefined)
    removedResponse()
    setupEditableResult('tab-del')

    const count = await useQueryStore.getState().deleteResultRows('tab-del')

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
    expect(ipc.calls('remove_result_rows')[0]).toEqual({
      connectionId: 'conn-1',
      tabId: 'tab-del',
      resultIndex: 0,
      queryId: 'q-del',
      baseViewVersion: 1,
      baseIndices: [0, 2],
    })
    // D16: no re-execute after a delete.
    expect(ipc.calls('execute_query')).toHaveLength(0)
    expect(ipc.calls('reexecute_single_result')).toHaveLength(0)

    const result = flat('tab-del')
    expect(result.totalRows).toBe(1)
    expect(result.viewRowCount).toBe(1)
    expect(result.viewVersion).toBe(2)
    expect(result.selectedRowIndex).toBeNull()
    expect(result.checkedRanges).toEqual([])
    await expectToast('success', 'Rows deleted')
  })

  it('resolves unloaded checked rows (header select-all) to base indices before deleting', async () => {
    ipc.override('delete_table_row', () => undefined)
    removedResponse()
    // The view is sorted: positions map to base indices 2, 0, 1. Only the first row is loaded.
    setupEditableResult('tab-del-sel', {
      ...withRows([[3, 'c']]),
      viewRowCount: 3,
      checkedRanges: [[0, 3]],
    })
    ipc.override('fetch_result_window', () => ({
      offset: 0,
      rows: [
        [3, 'c'],
        [1, 'a'],
        [2, 'b'],
      ],
      baseIndices: [2, 0, 1],
      viewRowCount: 3,
      viewVersion: 1,
    }))

    await useQueryStore.getState().deleteResultRows('tab-del-sel')

    expect(ipc.calls('fetch_result_window')).toHaveLength(1)
    expect(ipc.calls('remove_result_rows')[0]).toMatchObject({ baseIndices: [2, 0, 1] })
  })

  it('retries a superseded tombstone write once against the current version', async () => {
    ipc.override('delete_table_row', () => undefined)
    let attempt = 0
    ipc.override('remove_result_rows', () => {
      attempt += 1
      if (attempt === 1) throw new Error('view_superseded: current=5')
      return { viewVersion: 6, viewRowCount: 1, totalRows: 1 }
    })
    setupEditableResult('tab-del-cas')

    await useQueryStore.getState().deleteResultRows('tab-del-cas')

    const calls = ipc.calls('remove_result_rows') as Array<Record<string, unknown>>
    expect(calls.map((call) => call.baseViewVersion)).toEqual([1, 5])
    expect(flat('tab-del-cas').viewVersion).toBe(6)
  })

  it('never repaints a tombstone response older than the view already painted', async () => {
    // A sort committed on top of the tombstones (v3) and painted while the
    // delete's own response (v2) was still in flight.
    ipc.override('delete_table_row', () => {
      patchResult('tab-del-late', { viewVersion: 3, latestKnownViewVersion: 3 })
      return undefined
    })
    ipc.override('remove_result_rows', () => ({ viewVersion: 2, viewRowCount: 1, totalRows: 1 }))
    setupEditableResult('tab-del-late')

    await useQueryStore.getState().deleteResultRows('tab-del-late')

    const result = flat('tab-del-late')
    expect(result.viewVersion).toBe(3)
    expect(result.checkedRanges).toEqual([])
    expect(result.editState).toBeNull()
    await expectToast('success', 'Rows deleted')
  })

  it('marks the result stale with the Refresh failed toast when remove_result_rows fails', async () => {
    ipc.override('delete_table_row', () => undefined)
    ipc.override('remove_result_rows', () => {
      throw new Error('cache write failed')
    })
    setupEditableResult('tab-del-stale')

    const count = await useQueryStore.getState().deleteResultRows('tab-del-stale')

    expect(count).toBe(2)
    expect(flat('tab-del-stale').isStale).toBe(true)
    expect(flat('tab-del-stale').checkedRanges).toEqual([])
    await expectToast(
      'error',
      "2 rows deleted, but the result couldn't be updated. Re-run the query to refresh."
    )
    expect(ipc.calls('execute_query')).toHaveLength(0)
  })

  it('treats a second superseded refusal like any other tombstone failure', async () => {
    ipc.override('delete_table_row', () => undefined)
    ipc.override('remove_result_rows', () => {
      throw new Error('view_superseded: current=9')
    })
    setupEditableResult('tab-del-cas2')

    await useQueryStore.getState().deleteResultRows('tab-del-cas2')

    expect(ipc.calls('remove_result_rows')).toHaveLength(2)
    expect(flat('tab-del-cas2').isStale).toBe(true)
  })

  it('refuses to delete and warns when the result is not in edit mode', async () => {
    ipc.override('delete_table_row', () => undefined)
    setupEditableResult('tab-del-ro', { editMode: null })

    const count = await useQueryStore.getState().deleteResultRows('tab-del-ro')

    expect(count).toBe(0)
    expect(ipc.calls('delete_table_row')).toHaveLength(0)
    await expectToast('error', 'Enable edit mode')
  })

  it('refuses when the table has no key, or there is no edit connection', async () => {
    ipc.override('delete_table_row', () => undefined)
    setupEditableResult('tab-del-nopk', {
      editTableMetadata: { users: { ...editMetadata.users, primaryKey: null } },
    })
    expect(await useQueryStore.getState().deleteResultRows('tab-del-nopk')).toBe(0)
    await expectToast('error', 'no primary or unique key')

    setupEditableResult('tab-del-noconn', { editConnectionId: null })
    expect(await useQueryStore.getState().deleteResultRows('tab-del-noconn')).toBe(0)
    await expectToast('error', 'No active connection')
    expect(ipc.calls('delete_table_row')).toHaveLength(0)
  })

  it('refuses to delete when the key columns are absent from the result set', async () => {
    ipc.override('delete_table_row', () => undefined)
    setupEditableResult('tab-del-nokey', { editBoundColumnIndexMap: new Map([['name', 1]]) })

    const count = await useQueryStore.getState().deleteResultRows('tab-del-nokey')

    expect(count).toBe(0)
    expect(ipc.calls('delete_table_row')).toHaveLength(0)
    await expectToast('error', 'key columns')
  })

  it('deletes nothing for checked ranges of an older view, or above the 10,000-row cap', async () => {
    ipc.override('delete_table_row', () => undefined)
    setupEditableResult('tab-del-old', { checkedViewVersion: 0 })
    expect(await useQueryStore.getState().deleteResultRows('tab-del-old')).toBe(0)
    expect(flat('tab-del-old').checkedRanges).toEqual([])

    setupEditableResult('tab-del-cap', { viewRowCount: 100_000, checkedRanges: [[0, 100_000]] })
    expect(await useQueryStore.getState().deleteResultRows('tab-del-cap')).toBe(0)
    expect(ipc.calls('delete_table_row')).toHaveLength(0)
    expect(ipc.calls('fetch_result_window')).toHaveLength(0)
  })

  it('shows Delete failed and deletes nothing when the checked rows cannot be loaded', async () => {
    ipc.override('delete_table_row', () => undefined)
    ipc.override('fetch_result_window', () => {
      throw new Error('offline')
    })
    setupEditableResult('tab-del-load', {
      ...withRows([]),
      viewRowCount: 3,
      checkedRanges: [[0, 3]],
    })

    expect(await useQueryStore.getState().deleteResultRows('tab-del-load')).toBe(0)
    expect(ipc.calls('delete_table_row')).toHaveLength(0)
    await expectToast('error', 'offline')
  })

  it('routes results_expired while loading checked rows to the expired block', async () => {
    ipc.override('fetch_result_window', () => {
      throw new Error('results_expired: gone')
    })
    setupEditableResult('tab-del-exp', {
      ...withRows([]),
      viewRowCount: 3,
      checkedRanges: [[0, 3]],
    })

    expect(await useQueryStore.getState().deleteResultRows('tab-del-exp')).toBe(0)
    expect(flat('tab-del-exp').isExpired).toBe(true)
  })

  it('stops on the first failed delete and tombstones only the deleted subset', async () => {
    let callCount = 0
    ipc.override('delete_table_row', () => {
      callCount += 1
      if (callCount === 2) throw new Error('FK constraint')
      return undefined
    })
    removedResponse()
    useToastStore.setState({ toasts: [] })
    setupEditableResult('tab-del-err')

    const count = await useQueryStore.getState().deleteResultRows('tab-del-err')

    expect(count).toBe(1)
    expect(ipc.calls('remove_result_rows')[0]).toMatchObject({ baseIndices: [0] })
    const result = flat('tab-del-err')
    expect(result.saveError).toBe('FK constraint')
    await expectToast('error', 'FK constraint')
    // The failure already surfaced an error toast; no "Rows deleted" success.
    expect(
      useToastStore
        .getState()
        .toasts.some((toast) => toast.variant === 'success' && toast.title === 'Rows deleted')
    ).toBe(false)
  })

  it('records the error and tombstones nothing when the first delete fails', async () => {
    ipc.override('delete_table_row', () => {
      throw new Error('access denied')
    })
    setupEditableResult('tab-del-first-err')

    const count = await useQueryStore.getState().deleteResultRows('tab-del-first-err')

    expect(count).toBe(0)
    expect(ipc.calls('remove_result_rows')).toHaveLength(0)
    const result = flat('tab-del-first-err')
    expect(result.rows).toHaveLength(3)
    expect(result.saveError).toBe('access denied')
    await expectToast('error', 'access denied')
  })

  it('no-ops when nothing is checked', async () => {
    ipc.override('delete_table_row', () => undefined)
    setupEditableResult('tab-del-empty', { checkedRanges: [] })

    const count = await useQueryStore.getState().deleteResultRows('tab-del-empty')
    expect(count).toBe(0)
    expect(ipc.calls('delete_table_row')).toHaveLength(0)
    expect(flat('tab-del-empty').rows).toHaveLength(3)
  })

  it('reports "Deleting… done of n" progress through beginRowAction after 1 s', async () => {
    vi.useFakeTimers()
    try {
      let release: (() => void) | undefined
      ipc.override(
        'delete_table_row',
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          })
      )
      removedResponse()
      setupEditableResult('tab-del-progress', { checkedRanges: [[0, 1]] })

      const deletion = useQueryStore.getState().deleteResultRows('tab-del-progress')
      await vi.advanceTimersByTimeAsync(0)
      expect(flat('tab-del-progress').rowActionProgress).toMatchObject({
        verb: 'Deleting',
        total: 1,
        visible: false,
        cancellable: false,
      })
      await vi.advanceTimersByTimeAsync(1000)
      expect(flat('tab-del-progress').rowActionProgress?.visible).toBe(true)
      release?.()
      await vi.advanceTimersByTimeAsync(0)
      await deletion
      expect(flat('tab-del-progress').rowActionProgress).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('useQueryStore — row actions', () => {
  it('cancelRowAction calls the cancel hook of a cancellable action once', () => {
    useQueryStore.getState().setContent('tab-act', 'SELECT 1')
    patchResult('tab-act', { queryId: 'q-act' })
    const onCancel = vi.fn()
    const handle = useQueryStore.getState().beginRowAction('tab-act', 'Copying', 5000, onCancel)
    expect(flat('tab-act').rowActionProgress).toMatchObject({ cancellable: true, total: 5000 })
    handle.update(2000)
    useQueryStore.getState().cancelRowAction('tab-act')
    useQueryStore.getState().cancelRowAction('tab-act')
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(handle.finish()).toBe(false)
    expect(flat('tab-act').rowActionProgress).toBeNull()
  })

  it('updates the visible progress after the 1 s threshold', () => {
    vi.useFakeTimers()
    try {
      useQueryStore.getState().setContent('tab-act2', 'SELECT 1')
      patchResult('tab-act2', { queryId: 'q-act2' })
      const handle = useQueryStore.getState().beginRowAction('tab-act2', 'Pasting', 4000)
      vi.advanceTimersByTime(1000)
      handle.update(2000)
      expect(flat('tab-act2').rowActionProgress).toMatchObject({ visible: true, done: 2000 })
      expect(handle.finish()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('markResultsExpired and retryResultWindow are safe on any tab', () => {
    useQueryStore.getState().setContent('tab-exp', 'SELECT 1')
    patchResult('tab-exp', { queryId: 'q-exp' })
    useQueryStore.getState().markResultsExpired('tab-exp')
    expect(flat('tab-exp').isExpired).toBe(true)
    useQueryStore.getState().retryResultWindow('missing')
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
          firstWindow: firstWindowFor([[1], [2], [3]]),
          autoLimitApplied: false,
        }
      return null
    })

    await useQueryStore.getState().executeQuery('conn-1', 'tab-total', 'SELECT id FROM t')

    const f = flat('tab-total')
    expect(f.executionTimeMs).toBe(10)
    expect(f.totalTimeMs).toBe(45)
  })

  it('keeps totalTimeMs when clearing a sort (no re-execute)', async () => {
    useQueryStore.getState().setContent('tab-sort-total', 'SELECT 1')
    patchResult('tab-sort-total', {
      sortColumn: 'id',
      sortDirection: 'asc' as const,
      lastExecutedSql: 'SELECT id FROM t',
      queryId: 'q-old',
      totalTimeMs: 33,
      resultStatus: 'success' as const,
    })
    ipc.override('set_result_view', () => ({
      viewVersion: 2,
      viewRowCount: 0,
      totalRows: 0,
      firstWindow: { offset: 0, rows: [], baseIndices: [] },
    }))

    await useQueryStore.getState().sortResults('conn-1', 'tab-sort-total', 'id', null)

    expect(flat('tab-sort-total').totalTimeMs).toBe(33)
    expect(ipc.calls('execute_query')).toHaveLength(0)
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
          firstWindow: firstWindowFor([[1], [2]]),
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

describe('useQueryStore — connection-aware async completion', () => {
  /** Register a query tab as the selected tab for the given connection. */
  function registerQueryTab(connectionId: string, tabId: string): void {
    useWorkspaceStore.setState({
      tabsByConnection: {
        [connectionId]: [{ id: tabId, type: 'query-editor', label: 'Query', connectionId }],
      },
      activeTabByConnection: { [connectionId]: tabId },
    })
  }

  it('marks a completed result active when its connection is globally visible', async () => {
    resetWorkspaceStore({ visibleConnectionSessionId: 'conn-1' })
    registerQueryTab('conn-1', 'tab-visible')

    await useQueryStore.getState().executeQuery('conn-1', 'tab-visible', 'SELECT id FROM t')

    const residency = flat('tab-visible').rowResidency
    expect(residency.isActive).toBe(true)
    expect(residency.inactiveSince).toBeNull()
    expect(flat('tab-visible').rows).toEqual([[1], [2], [3]])
  })

  it('keeps a completed result resident-but-inactive when the connection is no longer visible', async () => {
    resetWorkspaceStore({ visibleConnectionSessionId: 'conn-other' })
    // The query tab belongs to conn-1, but conn-other is now globally visible.
    registerQueryTab('conn-1', 'tab-bg')

    await useQueryStore.getState().executeQuery('conn-1', 'tab-bg', 'SELECT id FROM t')

    const residency = flat('tab-bg').rowResidency
    expect(residency.status).toBe('resident')
    expect(residency.isActive).toBe(false)
    expect(typeof residency.inactiveSince).toBe('number')
    // Rows remain resident for immediate reuse / TTL eligibility.
    expect(flat('tab-bg').rows).toEqual([[1], [2], [3]])
  })

  it('keeps the first multi-result active only when the connection is visible', async () => {
    overrideCommands({
      execute_multi_query: () => ({
        results: [
          {
            queryId: 'q-1',
            columns: [{ name: 'id', dataType: 'INT' }],
            firstWindow: firstWindowFor([[1]]),
            totalRows: 1,
            executionTimeMs: 1,
            totalTimeMs: 1,
            affectedRows: 0,
            autoLimitApplied: false,
            error: null,
            sourceSql: 'SELECT id FROM t',
            reExecutable: true,
          },
        ],
      }),
    })
    resetWorkspaceStore({ visibleConnectionSessionId: 'conn-1' })
    registerQueryTab('conn-1', 'tab-multi-visible')

    await useQueryStore
      .getState()
      .executeMultiQuery('conn-1', 'tab-multi-visible', ['SELECT id FROM t'])

    expect(
      useQueryStore.getState().tabs['tab-multi-visible']?.results[0]?.rowResidency.isActive
    ).toBe(true)
  })

  it('keeps the first multi-result inactive when the connection is no longer visible', async () => {
    overrideCommands({
      execute_multi_query: () => ({
        results: [
          {
            queryId: 'q-1',
            columns: [{ name: 'id', dataType: 'INT' }],
            firstWindow: firstWindowFor([[1]]),
            totalRows: 1,
            executionTimeMs: 1,
            totalTimeMs: 1,
            affectedRows: 0,
            autoLimitApplied: false,
            error: null,
            sourceSql: 'SELECT id FROM t',
            reExecutable: true,
          },
        ],
      }),
    })
    resetWorkspaceStore({ visibleConnectionSessionId: 'conn-other' })
    registerQueryTab('conn-1', 'tab-multi-bg')

    await useQueryStore.getState().executeMultiQuery('conn-1', 'tab-multi-bg', ['SELECT id FROM t'])

    const residency = useQueryStore.getState().tabs['tab-multi-bg']?.results[0]?.rowResidency
    expect(residency?.status).toBe('resident')
    expect(residency?.isActive).toBe(false)
    expect(typeof residency?.inactiveSince).toBe('number')
  })
})

// ---------------------------------------------------------------------------
// Streaming full export job (Phase 2, D22): owned and polled by the store.
// ---------------------------------------------------------------------------

describe('full export job', () => {
  const TAB = 'tab-export'
  const CONN = 'conn-export'
  const REQUEST = {
    connectionId: CONN,
    resultIndex: 0,
    format: 'csv' as const,
    filePath: '/tmp/all.csv',
    includeHeaders: true,
  }

  type Progress = {
    status: 'running' | 'completed' | 'cancelled' | 'failed'
    rowsWritten: number
    bytesWritten: number
    elapsedMs: number
    stoppedAtSheetLimit: boolean
    error: string | null
  }
  let progress: Progress

  const running = (rowsWritten: number): Progress => ({
    status: 'running',
    rowsWritten,
    bytesWritten: rowsWritten * 10,
    elapsedMs: 1_000,
    stoppedAtSheetLimit: false,
    error: null,
  })

  function seedTruncatedTab(tabId = TAB, exportDialogOpen = true) {
    useQueryStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        [tabId]: {
          ...makeTabState({ connectionId: CONN, tabStatus: 'success' }),
          results: [
            {
              ...DEFAULT_RESULT_STATE,
              resultStatus: 'success',
              queryId: 'q-truncated',
              truncated: true,
              rowCeiling: 5,
              totalRows: 5,
              viewRowCount: 5,
              exportDialogOpen,
              preferredExportScope: 'allRows',
            },
          ],
        },
      },
    }))
  }

  const job = (tabId = TAB) => useQueryStore.getState().exportJobs[tabId]
  const progressCalls = () => ipc.calls('get_result_export_progress').length

  beforeEach(() => {
    vi.useFakeTimers()
    _resetToastTimeoutsForTests()
    useToastStore.setState({ toasts: [] })
    useQueryStore.setState({ exportJobs: {} })
    progress = running(0)
    ipc.override('start_result_export', () => 'job-1')
    ipc.override('get_result_export_progress', () => progress)
    ipc.override('cancel_result_export', () => null)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function startAndFirstPoll(tabId = TAB) {
    await useQueryStore.getState().startFullExport(tabId, REQUEST)
    await vi.advanceTimersByTimeAsync(0)
  }

  it('starts the export for the result, polls progress, and completes with a toast', async () => {
    seedTruncatedTab()
    await startAndFirstPoll()

    expect(ipc.calls('start_result_export')[0]).toEqual({
      connectionId: CONN,
      tabId: TAB,
      resultIndex: 0,
      queryId: 'q-truncated',
      format: 'csv',
      filePath: '/tmp/all.csv',
      includeHeaders: true,
      tableName: null,
    })
    expect(job()).toMatchObject({ jobId: 'job-1', status: 'running', queryId: 'q-truncated' })
    expect(job()?.progress?.rowsWritten).toBe(0)

    progress = running(1_500)
    await vi.advanceTimersByTimeAsync(RESULT_EXPORT_POLL_MS)
    expect(job()?.progress?.rowsWritten).toBe(1_500)

    progress = { ...running(250_000), status: 'completed' }
    await vi.advanceTimersByTimeAsync(RESULT_EXPORT_POLL_MS)
    expect(job()).toBeUndefined()
    expect(flat(TAB).exportDialogOpen).toBe(false)
    await expectToast('success', 'Export completed')
    await expectToast('success', '250,000 rows saved to /tmp/all.csv')

    // Polling stopped.
    const calls = progressCalls()
    await vi.advanceTimersByTimeAsync(RESULT_EXPORT_POLL_MS * 3)
    expect(progressCalls()).toBe(calls)
  })

  it('mentions the Excel sheet limit and a failed database restore', async () => {
    seedTruncatedTab()
    progress = {
      ...running(1_048_575),
      status: 'completed',
      stoppedAtSheetLimit: true,
      error: "The session couldn't switch back to database 'crm': denied",
    }
    await startAndFirstPoll()

    await expectToast('success', "Stopped at Excel's 1,048,576-row limit.")
    await expectToast('warning', "couldn't switch back to database 'crm'")
  })

  it('keeps polling and never cancels when the dialog closes on a tab switch', async () => {
    seedTruncatedTab()
    await startAndFirstPoll()
    // ResultPanel closes the dialog whenever its tab goes inactive.
    useQueryStore.getState().closeExportDialog(TAB)

    const calls = progressCalls()
    await vi.advanceTimersByTimeAsync(RESULT_EXPORT_POLL_MS * 2)
    expect(progressCalls()).toBeGreaterThan(calls)
    expect(ipc.calls('cancel_result_export')).toHaveLength(0)
    expect(job()?.status).toBe('running')

    // Completion while the tab is inactive still shows the toast.
    progress = { ...running(42), status: 'completed' }
    await vi.advanceTimersByTimeAsync(RESULT_EXPORT_POLL_MS)
    await expectToast('success', '42 rows saved to /tmp/all.csv')
    expect(job()).toBeUndefined()
  })

  it('cleanupTab cancels a running export and stops polling', async () => {
    seedTruncatedTab()
    await startAndFirstPoll()

    useQueryStore.getState().cleanupTab(CONN, TAB)
    await vi.advanceTimersByTimeAsync(0)
    expect(ipc.calls('cancel_result_export')).toEqual([{ jobId: 'job-1' }])
    expect(job()).toBeUndefined()
    const calls = progressCalls()
    await vi.advanceTimersByTimeAsync(RESULT_EXPORT_POLL_MS * 2)
    expect(progressCalls()).toBe(calls)
  })

  it('cleanupConnection stops polling and drops the job without cancelling', async () => {
    seedTruncatedTab()
    await startAndFirstPoll()

    useQueryStore.getState().cleanupConnection(CONN, [TAB])
    expect(job()).toBeUndefined()
    const calls = progressCalls()
    await vi.advanceTimersByTimeAsync(RESULT_EXPORT_POLL_MS * 2)
    expect(progressCalls()).toBe(calls)
    expect(ipc.calls('cancel_result_export')).toHaveLength(0)
  })

  it('survives a re-run in the same tab and still shows its completion toast', async () => {
    seedTruncatedTab()
    await startAndFirstPoll()

    await useQueryStore.getState().executeQuery(CONN, TAB, 'SELECT id FROM t')
    expect(flat(TAB).queryId).toBe('q-mock')
    expect(job()).toMatchObject({ jobId: 'job-1', status: 'running', queryId: 'q-truncated' })

    progress = { ...running(9), status: 'completed' }
    await vi.advanceTimersByTimeAsync(RESULT_EXPORT_POLL_MS)
    await expectToast('success', '9 rows saved to /tmp/all.csv')
  })

  it('a failure shows showErrorToast and keeps the state while the dialog is open', async () => {
    seedTruncatedTab()
    progress = { ...running(3), status: 'failed', error: 'Query failed: Deadlock found' }
    await startAndFirstPoll()

    await expectToast('error', 'Export failed')
    expect(job()).toMatchObject({ status: 'failed', error: 'Query failed: Deadlock found' })

    // Closing the dialog dismisses the finished job.
    useQueryStore.getState().closeExportDialog(TAB)
    expect(job()).toBeUndefined()
  })

  it('a failure while the dialog is closed only toasts', async () => {
    seedTruncatedTab(TAB, false)
    progress = { ...running(3), status: 'failed', error: null }
    await startAndFirstPoll()
    await expectToast('error', 'The export stopped unexpectedly.')
    expect(job()).toBeUndefined()
  })

  it('cancel sends cancel_result_export once and ends in the cancelled state', async () => {
    seedTruncatedTab()
    await startAndFirstPoll()

    await useQueryStore.getState().cancelFullExport(TAB)
    await useQueryStore.getState().cancelFullExport(TAB)
    expect(ipc.calls('cancel_result_export')).toEqual([{ jobId: 'job-1' }])
    expect(job()?.cancelRequested).toBe(true)

    progress = { ...running(10), status: 'cancelled' }
    await vi.advanceTimersByTimeAsync(RESULT_EXPORT_POLL_MS)
    expect(job()).toMatchObject({ status: 'cancelled', cancelRequested: false })
  })

  it('a failed cancel shows a toast and re-enables Cancel export', async () => {
    seedTruncatedTab()
    await startAndFirstPoll()
    ipc.override('cancel_result_export', () => {
      throw new Error('no pool')
    })

    await useQueryStore.getState().cancelFullExport(TAB)
    await expectToast('error', 'Cancel failed')
    expect(job()?.cancelRequested).toBe(false)
  })

  it('a cancel while starting is sent as soon as the job id arrives', async () => {
    seedTruncatedTab()
    let resolveStart: (id: string) => void = () => {}
    ipc.override('start_result_export', () => new Promise<string>((r) => (resolveStart = r)))

    const started = useQueryStore.getState().startFullExport(TAB, REQUEST)
    await vi.advanceTimersByTimeAsync(0)
    await useQueryStore.getState().cancelFullExport(TAB)
    expect(ipc.calls('cancel_result_export')).toHaveLength(0)
    expect(job()).toMatchObject({ status: 'running', jobId: null, cancelRequested: true })
    progress = { ...running(0), status: 'cancelled' }
    resolveStart('job-queued')
    await started
    await vi.advanceTimersByTimeAsync(0)
    expect(ipc.calls('cancel_result_export')).toEqual([{ jobId: 'job-queued' }])
    // The job is tracked and polled to its end, so the dialog can close and a
    // new export can start (it used to stay "Cancelling…" with no job id).
    expect(ipc.calls('get_result_export_progress')).toEqual([{ jobId: 'job-queued' }])
    expect(job()).toMatchObject({
      jobId: 'job-queued',
      status: 'cancelled',
      cancelRequested: false,
    })

    useQueryStore.getState().closeExportDialog(TAB)
    expect(job()).toBeUndefined()
    progress = running(0)
    ipc.override('start_result_export', () => 'job-1')
    await startAndFirstPoll()
    expect(ipc.calls('start_result_export')).toHaveLength(2)
    expect(job()).toMatchObject({ jobId: 'job-1', status: 'running' })
  })

  it('a start that fails after a cancel was queued ends in the failed state', async () => {
    seedTruncatedTab()
    let rejectStart: (error: Error) => void = () => {}
    ipc.override(
      'start_result_export',
      () => new Promise<string>((_, reject) => (rejectStart = reject))
    )

    const started = useQueryStore.getState().startFullExport(TAB, REQUEST)
    await vi.advanceTimersByTimeAsync(0)
    await useQueryStore.getState().cancelFullExport(TAB)
    rejectStart(new Error('Connection lost'))
    await started
    expect(job()).toMatchObject({ status: 'failed', error: 'Connection lost', jobId: null })
    await expectToast('error', 'Export failed')
    expect(ipc.calls('cancel_result_export')).toHaveLength(0)
  })

  it('a start that fails after its tab closed is only logged', async () => {
    seedTruncatedTab()
    let rejectStart: (error: Error) => void = () => {}
    ipc.override(
      'start_result_export',
      () => new Promise<string>((_, reject) => (rejectStart = reject))
    )

    const started = useQueryStore.getState().startFullExport(TAB, REQUEST)
    await vi.advanceTimersByTimeAsync(0)
    useQueryStore.getState().cleanupTab(CONN, TAB)
    rejectStart(new Error('Connection lost'))
    await started
    expect(job()).toBeUndefined()
    expect(useToastStore.getState().toasts).toHaveLength(0)
    expect(ipc.calls('log_frontend')).toContainEqual({
      level: 'info',
      message: expect.stringContaining('start_result_export failed after its job was dropped'),
    })
  })

  it('closing the tab while starting cancels the job once it starts', async () => {
    seedTruncatedTab()
    let resolveStart: (id: string) => void = () => {}
    ipc.override('start_result_export', () => new Promise<string>((r) => (resolveStart = r)))

    const started = useQueryStore.getState().startFullExport(TAB, REQUEST)
    await vi.advanceTimersByTimeAsync(0)
    useQueryStore.getState().cleanupTab(CONN, TAB)
    resolveStart('job-late')
    await started
    await vi.advanceTimersByTimeAsync(0)
    expect(ipc.calls('cancel_result_export')).toEqual([{ jobId: 'job-late' }])
    expect(job()).toBeUndefined()
    expect(progressCalls()).toBe(0)
  })

  it('a refused start fails with a toast; an expired result routes to the expired block', async () => {
    seedTruncatedTab()
    ipc.override('start_result_export', () => {
      throw new Error("Full export isn't available for this result.")
    })
    await useQueryStore.getState().startFullExport(TAB, REQUEST)
    expect(job()).toMatchObject({
      status: 'failed',
      jobId: null,
      error: "Full export isn't available for this result.",
    })
    await expectToast('error', 'Export failed')

    ipc.override('start_result_export', () => {
      throw new Error('results_expired: Results expired. Re-run the query.')
    })
    await useQueryStore.getState().startFullExport(TAB, REQUEST)
    expect(job()).toBeUndefined()
    expect(flat(TAB).isExpired).toBe(true)
    expect(flat(TAB).exportDialogOpen).toBe(false)
  })

  it('a progress poll failure fails the job', async () => {
    seedTruncatedTab()
    ipc.override('get_result_export_progress', () => {
      throw new Error("Export job 'job-1' not found")
    })
    await startAndFirstPoll()
    await expectToast('error', "Export job 'job-1' not found")
    expect(job()?.status).toBe('failed')
  })

  it('ignores a second start while an export runs', async () => {
    seedTruncatedTab()
    await startAndFirstPoll()
    await useQueryStore.getState().startFullExport(TAB, REQUEST)
    expect(ipc.calls('start_result_export')).toHaveLength(1)
  })
})
