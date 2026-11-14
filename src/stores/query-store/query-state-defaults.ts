import type { QueryTableEditInfo, ResultWindow } from '../../types/schema'
import { useSettingsStore } from '../settings-store'
import type { SingleResultState, TabQueryState } from './query-state-types'

export const FALLBACK_ROW_LIMIT = 1000

export function getDefaultRowLimit(): number {
  const state = useSettingsStore.getState()
  if (Object.keys(state.settings).length > 0) {
    const parsed = parseInt(state.getSetting('results.pageSize'), 10)
    if (parsed > 0) return parsed
  }
  return FALLBACK_ROW_LIMIT
}

export const RESULT_EXPORT_POLL_MS = 500

export const MAX_BULK_DELETE_ROWS = 10_000

export const VIEW_REFRESH_WINDOW_ROWS = 1000

export const EDIT_ANALYSIS_ERROR_TOAST_DURATION_MS = 10_000

export const BULK_DELETE_WARNING_ROWS = 1_000

export const TEXT_VIEW_ROW_CAP = 5_000

const EMPTY_MAP = Object.freeze(new Map()) as Map<never, never>

const EMPTY_ARRAY = Object.freeze([]) as never[]

export const EMPTY_OBJECT = Object.freeze({}) as Record<string, QueryTableEditInfo>

export const DEFAULT_RESULT_STATE: SingleResultState = {
  resultStatus: 'idle',
  columns: [],
  totalRows: 0,
  viewRowCount: 0,
  viewVersion: 0,
  latestKnownViewVersion: 0,
  viewRequestSeq: 0,
  truncated: false,
  rowCeiling: 0,
  appliedRowLimit: null,
  fullExportBlockedReason: null,
  executionTimeMs: 0,
  totalTimeMs: 0,
  affectedRows: 0,
  queryId: null,
  rowLimit: FALLBACK_ROW_LIMIT,
  autoLimitApplied: false,
  errorMessage: null,
  viewMode: 'grid',
  sortColumn: null,
  sortDirection: null,
  selectedRowIndex: null,
  checkedRanges: [],
  checkedViewVersion: 0,
  exportDialogOpen: false,
  preferredExportScope: 'currentView',
  lastExecutedSql: null,
  reExecutable: true,
  isAnalyzed: false,
  selectedCell: null,
  filterModel: [],
  isFiltering: false,
  viewError: null,
  pendingWindowRange: null,
  failedWindowRange: null,
  rowActionProgress: null,

  editMode: null,
  editTableMetadata: EMPTY_OBJECT,
  editForeignKeys: EMPTY_ARRAY,
  editState: null,
  isAnalyzingQuery: false,
  editableColumnMap: EMPTY_MAP,
  editColumnBindings: EMPTY_MAP,
  editBoundColumnIndexMap: EMPTY_MAP,
  saveError: null,
  isStale: false,
  editConnectionId: null,
  editingRowIndex: null,
  editingBaseIndex: null,
  draftRow: null,
  scrollRow: 0,
  scrollCol: 0,
  isExpired: false,
  rowResidency: {
    status: 'resident',
    isActive: false,
    inactiveSince: null,
  },
  rowsEvictedAt: null,
  isSorting: false,
}

export const DEFAULT_TAB_STATE: TabQueryState = {
  content: '',
  selectedText: '',
  filePath: null,
  tabStatus: 'idle',
  prevTabStatus: 'idle',
  cursorPosition: null,
  connectionId: '',
  results: [],
  activeResultIndex: 0,
  activeBottomPanelItem: { type: 'result' },
  pendingNavigationAction: null,
  executionStartedAt: null,
  isCancelling: false,
  wasCancelled: false,
}

export const ROW_EDIT_STATE_RESET: Partial<SingleResultState> = {
  editState: null,
  editingRowIndex: null,
  editingBaseIndex: null,
  draftRow: null,
  saveError: null,
}

export const EDIT_STATE_DEFAULTS: Partial<SingleResultState> = {
  editMode: null,
  editTableMetadata: EMPTY_OBJECT,
  editForeignKeys: EMPTY_ARRAY,
  editState: null,
  isAnalyzingQuery: false,
  editableColumnMap: EMPTY_MAP,
  editColumnBindings: EMPTY_MAP,
  editBoundColumnIndexMap: EMPTY_MAP,
  saveError: null,
  isStale: false,
  editConnectionId: null,
  editingRowIndex: null,
  editingBaseIndex: null,
  draftRow: null,
}

export const EMPTY_WINDOW: ResultWindow = { offset: 0, rows: [], baseIndices: [] }
