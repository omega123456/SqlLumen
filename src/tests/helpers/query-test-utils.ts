/**
 * Test helper to build TabQueryState with the new multi-result shape.
 *
 * Converts flat result-level fields into a results[] array,
 * minimizing the changes needed in existing test files.
 */
import type { TabQueryState, SingleResultState } from '../../stores/query-store'
import { DEFAULT_RESULT_STATE } from '../../stores/query-store'
import type {
  ColumnMeta,
  ForeignKeyColumnInfo,
  QueryTableEditInfo,
  RowEditState,
  ViewMode,
} from '../../types/schema'

/** Fields that belong on a SingleResultState (per-result). */
interface ResultOverrides {
  resultStatus?: 'idle' | 'running' | 'success' | 'error'
  columns?: ColumnMeta[]
  rows?: unknown[][]
  totalRows?: number
  executionTimeMs?: number
  affectedRows?: number
  queryId?: string | null
  currentPage?: number
  totalPages?: number
  pageSize?: number
  autoLimitApplied?: boolean
  errorMessage?: string | null
  viewMode?: ViewMode
  sortColumn?: string | null
  sortDirection?: 'asc' | 'desc' | null
  selectedRowIndex?: number | null
  exportDialogOpen?: boolean
  lastExecutedSql?: string | null
  reExecutable?: boolean
  isAnalyzed?: boolean

  editMode?: string | null
  editTableMetadata?: Record<string, QueryTableEditInfo>
  editForeignKeys?: ForeignKeyColumnInfo[]
  editState?: RowEditState | null
  isAnalyzingQuery?: boolean
  editableColumnMap?: Map<number, boolean>
  editColumnBindings?: Map<number, string>
  editBoundColumnIndexMap?: Map<string, number>
  saveError?: string | null
  editConnectionId?: string | null
  editingRowIndex?: number | null
}

/** Fields that belong on TabQueryState (tab-level). */
interface TabOverrides {
  content?: string
  filePath?: string | null
  cursorPosition?: { lineNumber: number; column: number } | null
  connectionId?: string
  pendingNavigationAction?: (() => void) | null
  executionStartedAt?: number | null
  isCancelling?: boolean
  wasCancelled?: boolean
}

// All keys that belong to SingleResultState
const RESULT_KEYS = new Set<string>([
  'resultStatus',
  'columns',
  'rows',
  'totalRows',
  'executionTimeMs',
  'affectedRows',
  'queryId',
  'currentPage',
  'totalPages',
  'pageSize',
  'autoLimitApplied',
  'errorMessage',
  'viewMode',
  'sortColumn',
  'sortDirection',
  'selectedRowIndex',
  'exportDialogOpen',
  'lastExecutedSql',
  'reExecutable',
  'isAnalyzed',
  'editMode',
  'editTableMetadata',
  'editForeignKeys',
  'editState',
  'isAnalyzingQuery',
  'editableColumnMap',
  'editColumnBindings',
  'editBoundColumnIndexMap',
  'saveError',
  'editConnectionId',
  'editingRowIndex',
])

/**
 * Build a TabQueryState from flat overrides (old shape compatibility).
 * Splits the overrides into tab-level and result-level fields,
 * creating a single-element results array.
 *
 * The `tabStatus` field is applied to the tab level; `resultStatus` to the result level.
 * The legacy `status` shorthand sets both `tabStatus` and `resultStatus` at once.
 * For convenience, if none are provided, both default to 'idle'.
 */
export function makeTabState(
  overrides: ResultOverrides &
    TabOverrides & {
      tabStatus?: 'idle' | 'running' | 'success' | 'error'
      /** Legacy shorthand: sets both tabStatus and resultStatus. */
      status?: 'idle' | 'running' | 'success' | 'error'
    } = {}
): TabQueryState {
  const resultOverrides: Partial<SingleResultState> = {}
  const tabOverrides: Partial<TabQueryState> = {}

  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'status') {
      // Legacy shorthand: apply to both tab and result level
      tabOverrides.tabStatus = value as TabQueryState['tabStatus']
      resultOverrides.resultStatus = value as SingleResultState['resultStatus']
    } else if (key === 'tabStatus') {
      tabOverrides.tabStatus = value as TabQueryState['tabStatus']
    } else if (key === 'resultStatus') {
      resultOverrides.resultStatus = value as SingleResultState['resultStatus']
    } else if (RESULT_KEYS.has(key)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(resultOverrides as any)[key] = value
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(tabOverrides as any)[key] = value
    }
  }

  const singleResult: SingleResultState = {
    ...DEFAULT_RESULT_STATE,
    ...resultOverrides,
  }

  return {
    content: '',
    filePath: null,
    tabStatus: 'idle',
    prevTabStatus: 'idle',
    cursorPosition: null,
    connectionId: '',
    results: [singleResult],
    activeResultIndex: 0,
    pendingNavigationAction: null,
    executionStartedAt: null,
    isCancelling: false,
    wasCancelled: false,
    ...tabOverrides,
  }
}

/**
 * Get the active result from a tab state (for assertions in tests).
 */
export function getTestActiveResult(tab: TabQueryState): SingleResultState {
  if (tab.results.length === 0) return { ...DEFAULT_RESULT_STATE }
  const idx = Math.min(tab.activeResultIndex, tab.results.length - 1)
  return tab.results[idx] ?? { ...DEFAULT_RESULT_STATE }
}
