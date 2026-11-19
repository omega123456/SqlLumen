import type {
  DataViewEditSession,
  DataViewEditTarget,
  DataViewPatch,
  DataViewState,
} from './data-view-types'

const EMPTY_MAP = Object.freeze(new Map()) as Map<never, never>

const EMPTY_ARRAY = Object.freeze([]) as never[]

const EMPTY_RECORD = Object.freeze({}) as Record<string, never>

export const DEFAULT_EDIT_SESSION: DataViewEditSession = {
  state: null,
  rowIndex: null,
  baseIndex: null,
  draftRow: null,
  saveError: null,
  isStale: false,
}

export const DEFAULT_EDIT_TARGET: DataViewEditTarget = {
  tableName: null,
  tables: EMPTY_RECORD,
  foreignKeys: EMPTY_ARRAY,
  editableColumns: EMPTY_MAP,
  bindings: EMPTY_MAP,
  boundIndexByName: EMPTY_MAP,
}

export const DEFAULT_DATA_VIEW_STATE: DataViewState = {
  mode: 'grid',
  slot: {
    connectionId: '',
    queryId: null,
    columns: EMPTY_ARRAY,
    viewVersion: 0,
    viewRowCount: 0,
    totalRows: 0,
  },
  selection: { rowIndex: null, cell: null },
  checked: { ranges: EMPTY_ARRAY, viewVersion: 0 },
  layout: { scrollRow: 0, scrollCol: 0, columnWidths: EMPTY_RECORD },
  spec: { sort: null, filters: EMPTY_ARRAY, applying: null, error: null },
  window: { pendingRange: null, failedRange: null },
  edit: DEFAULT_EDIT_SESSION,
  editTarget: DEFAULT_EDIT_TARGET,
  residency: {
    rows: { status: 'resident', isActive: false, inactiveSince: null },
    evictedAt: null,
    isExpired: false,
  },
  prompts: { isExportOpen: false, exportScope: 'currentView', pendingNavigation: null },
  rowAction: null,
}

export const CLOSED_EDIT_PATCH: DataViewPatch = {
  edit: { state: null, rowIndex: null, baseIndex: null, saveError: null },
}

export const DISCARDED_DRAFT_PATCH: DataViewPatch = {
  edit: { state: null, rowIndex: null, baseIndex: null, saveError: null, draftRow: null },
  selection: { rowIndex: null },
}

export const SAVED_EDIT_PATCH: DataViewPatch = {
  edit: { state: null, rowIndex: null, baseIndex: null, saveError: null, isStale: false },
}

export const SAVED_DRAFT_PATCH: DataViewPatch = {
  edit: {
    state: null,
    rowIndex: null,
    baseIndex: null,
    saveError: null,
    isStale: false,
    draftRow: null,
  },
  selection: { rowIndex: null },
}
