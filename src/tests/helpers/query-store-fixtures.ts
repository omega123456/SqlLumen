import { beforeEach, afterEach, vi } from 'vitest'
import { overrideIpcCommands, overrideNamedIpcCommands } from '../ipc-mock'
import {
  DEFAULT_RESULT_STATE,
  useQueryStore,
  type ResultPatch,
  type SingleResultState,
} from '../../stores/query-store'
import { patchedResult } from '../../stores/query-store/query-tab-reducers'
import { mergeViewPatches } from '../../stores/data-view/data-view-reducers'
import type { DataViewPatch } from '../../stores/data-view/data-view-types'
import { useToastStore, _resetToastTimeoutsForTests } from '../../stores/toast-store'
import { useTableDataStore } from '../../stores/table-data-store'
import type {
  BlobEnvelope,
  PrimaryKeyInfo,
  QueryTableEditInfo,
  TableDataColumnMeta,
} from '../../types/schema'
import { firstWindowFor, pendingRowsOf, withPendingRows } from './query-test-utils'
import { resetWorkspaceStore } from './workspace-test-utils'

export const overrideNamedCommands = overrideNamedIpcCommands

export const QUERY_STORE_EDIT_COMMANDS = [
  'analyze_query_for_edit',
  'evict_results',
  'execute_query',
  'insert_table_row',
  'set_result_view',
  'update_result_cell',
  'update_table_row',
] as const

function pendingRowsViewPatch(patch: ResultPatch, rows: unknown[][] | undefined): DataViewPatch {
  const view = patch.view ?? {}
  const hasViewRowCount = view.slot?.viewRowCount !== undefined
  if (!rows || hasViewRowCount) return view
  return mergeViewPatches(view, { slot: { viewRowCount: rows.length } })
}

/**
 * `base` with `patch` applied. Rows marked with `withRows` travel with the
 * result (and set its view row count unless the patch sets one).
 */
export function resultWith(
  patch: ResultPatch,
  base: SingleResultState = DEFAULT_RESULT_STATE
): SingleResultState {
  const rows = pendingRowsOf(patch)
  const view = pendingRowsViewPatch(patch, rows)
  return withPendingRows(patchedResult(base, { ...patch, view: view }), rows)
}

/**
 * Patch an existing tab's results[0].
 * Works for tabs populated by executeQuery (which creates results[0]).
 */
export function patchResult(tabId: string, patch: ResultPatch) {
  useQueryStore.setState((prev) => {
    const tab = prev.tabs[tabId]!
    const existingResult = tab.results[0] ?? DEFAULT_RESULT_STATE
    return {
      tabs: {
        ...prev.tabs,
        [tabId]: {
          ...tab,
          results: [resultWith(patch, existingResult)],
          activeResultIndex: 0,
        },
      },
    }
  })
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const mockTableColumns: TableDataColumnMeta[] = [
  {
    name: 'id',
    dataType: 'INT',
    isBooleanAlias: false,
    isNullable: false,
    isPrimaryKey: true,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: true,
  },
  {
    name: 'name',
    dataType: 'VARCHAR',
    isBooleanAlias: false,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
  },
  {
    name: 'email',
    dataType: 'VARCHAR',
    isBooleanAlias: false,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
  },
]

export const mockBlobEnvelope: BlobEnvelope = {
  __sqllumen_blob__: true,
  kind: 'bytes',
  base64: 'U1FMLUx1bWVu',
}

export const mockPrimaryKey: PrimaryKeyInfo = {
  keyColumns: ['id'],
  hasAutoIncrement: true,
  isUniqueKeyFallback: false,
}

export const mockOrderColumns: TableDataColumnMeta[] = [
  {
    name: 'id',
    dataType: 'INT',
    isBooleanAlias: false,
    isNullable: false,
    isPrimaryKey: true,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: true,
  },
  {
    name: 'user_id',
    dataType: 'INT',
    isBooleanAlias: false,
    isNullable: false,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
  },
  {
    name: 'total',
    dataType: 'DECIMAL',
    isBooleanAlias: false,
    isNullable: false,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
  },
]

export const mockOrderPrimaryKey: PrimaryKeyInfo = {
  keyColumns: ['id'],
  hasAutoIncrement: true,
  isUniqueKeyFallback: false,
}

export const mockAnalyzeResult: QueryTableEditInfo[] = [
  {
    database: 'testdb',
    table: 'users',
    columns: mockTableColumns,
    primaryKey: mockPrimaryKey,
    foreignKeys: [],
  },
]

export const mockNaturalKeyColumns: TableDataColumnMeta[] = [
  {
    name: 'code',
    dataType: 'VARCHAR',
    isBooleanAlias: false,
    isNullable: false,
    isPrimaryKey: true,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
  },
  {
    name: 'name',
    dataType: 'VARCHAR',
    isBooleanAlias: false,
    isNullable: false,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isAutoIncrement: false,
  },
]

export const mockNaturalPk: PrimaryKeyInfo = {
  keyColumns: ['code'],
  hasAutoIncrement: false,
  isUniqueKeyFallback: false,
}

export const mockNaturalAnalyzeResult: QueryTableEditInfo[] = [
  {
    database: 'testdb',
    table: 'projects',
    columns: mockNaturalKeyColumns,
    primaryKey: mockNaturalPk,
    foreignKeys: [],
  },
]

export const mockJoinAnalyzeResult: QueryTableEditInfo[] = [
  ...mockAnalyzeResult,
  {
    database: 'testdb',
    table: 'orders',
    columns: mockOrderColumns,
    primaryKey: mockOrderPrimaryKey,
    foreignKeys: [],
  },
]

/** Flush microtasks so fire-and-forget promises complete. */
export function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Helper: execute a query and wait for background analysis to complete.
 */
export async function executeAndAnalyze(connId = 'conn-1', tabId = 'tab-1') {
  await useQueryStore.getState().executeQuery(connId, tabId, 'SELECT * FROM users')
  await flushMicrotasks()
}

export const overrideCommands = overrideIpcCommands

export const QUERY_STORE_COMMANDS = [
  'analyze_query_for_edit',
  'cancel_query',
  'evict_results',
  'execute_multi_query',
  'execute_query',
] as const

export const BOOLEAN_ALIAS_COLUMNS = [
  { name: 'is_active', dataType: 'BOOLEAN' },
  { name: 'is_archived', dataType: 'BOOL' },
  { name: 'label', dataType: 'VARCHAR' },
]

export function registerQueryEditStoreSetup() {
  beforeEach(() => {
    useQueryStore.setState({ tabs: {} })
    useToastStore.setState({ toasts: [] })
    _resetToastTimeoutsForTests()

    overrideNamedCommands(QUERY_STORE_EDIT_COMMANDS, (cmd) => {
      switch (cmd) {
        case 'execute_query':
          return {
            queryId: 'q-mock',
            columns: [
              { name: 'id', dataType: 'INT' },
              { name: 'name', dataType: 'VARCHAR' },
              { name: 'email', dataType: 'VARCHAR' },
            ],
            totalRows: 2,
            executionTimeMs: 10,
            affectedRows: 0,
            firstWindow: firstWindowFor([
              [1, 'Alice', 'alice@test.com'],
              [2, 'Bob', 'bob@test.com'],
            ]),

            autoLimitApplied: false,
          }
        case 'analyze_query_for_edit':
          return mockAnalyzeResult
        case 'update_table_row':
          return null
        case 'update_result_cell':
          return null
        case 'evict_results':
          return null
        case 'set_result_view':
          return {
            viewVersion: 2,
            viewRowCount: 2,
            totalRows: 2,
            firstWindow: firstWindowFor([
              [1, 'Alice', 'alice@test.com'],
              [2, 'Bob', 'bob@test.com'],
            ]),
          }
        default:
          return null
      }
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })
}

export function registerQueryStoreSetup() {
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
}
