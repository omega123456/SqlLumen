import type { QueryTableEditInfo, ResultWindow } from '../../types/schema'
import { useSettingsStore } from '../settings-store'
import type { ResultPatch, SingleResultState, TabQueryState } from './query-state-types'
import {
  DEFAULT_DATA_VIEW_STATE,
  DEFAULT_EDIT_SESSION,
  DEFAULT_EDIT_TARGET,
} from '../data-view/data-view-defaults'

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

export const EDIT_ANALYSIS_ERROR_TOAST_DURATION_MS = 10_000

export const EMPTY_OBJECT = Object.freeze({}) as Record<string, QueryTableEditInfo>

export const DEFAULT_RESULT_STATE: SingleResultState = {
  resultStatus: 'idle',
  latestKnownViewVersion: 0,
  viewRequestSeq: 0,
  truncated: false,
  rowCeiling: 0,
  exportedRowCount: null,
  appliedRowLimit: null,
  fullExportBlockedReason: null,
  executionTimeMs: 0,
  totalTimeMs: 0,
  affectedRows: 0,
  rowLimit: FALLBACK_ROW_LIMIT,
  autoLimitApplied: false,
  errorMessage: null,
  lastExecutedSql: null,
  reExecutable: true,
  isAnalyzed: false,
  isAnalyzingQuery: false,
  view: DEFAULT_DATA_VIEW_STATE,
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
  executionStartedAt: null,
  isCancelling: false,
  wasCancelled: false,
  runExport: null,
}

export const EDIT_STATE_DEFAULTS: ResultPatch = {
  isAnalyzingQuery: false,
  view: { edit: DEFAULT_EDIT_SESSION, editTarget: DEFAULT_EDIT_TARGET },
}

export const EMPTY_WINDOW: ResultWindow = { offset: 0, rows: [], baseIndices: [] }
