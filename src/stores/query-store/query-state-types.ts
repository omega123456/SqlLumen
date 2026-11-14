import type {
  ColumnMeta,
  ExportFormat,
  FilterCondition,
  FrontendRowResidencyState,
  FullExportBlockedReason,
  QueryTableEditInfo,
  RowEditState,
  SelectedCellInfo,
  ViewMode,
  ForeignKeyColumnInfo,
} from '../../types/schema'
import { type CachedRow, type ViewRange } from '../../lib/result-window-cache'
import { type ResultExportProgress, type ResultExportStatus } from '../../lib/export-commands'

export type ExecutionStatus = 'idle' | 'running' | 'success' | 'error'

export type ExportRowScope = 'currentView' | 'allRows'

export interface FullExportRequest {
  connectionId: string
  resultIndex: number
  format: ExportFormat
  filePath: string
  includeHeaders: boolean
  tableName?: string
}

export interface ResultExportJob extends FullExportRequest {
  jobId: string | null
  queryId: string
  status: ResultExportStatus
  progress: ResultExportProgress | null
  cancelRequested: boolean
  error: string | null
  startToken: number
}

export type RowActionVerb = 'Copying' | 'Cutting' | 'Clearing' | 'Pasting' | 'Deleting'

export interface RowActionStart {
  verb: RowActionVerb
  total: number
  onCancel?: () => void
}

export interface RowActionProgress {
  verb: RowActionVerb
  done: number
  total: number
  cancellable: boolean
  visible: boolean
}

export type TabStatus = ExecutionStatus | 'ai-pending' | 'ai-reviewing' | 'restoring'

export type ActiveBottomPanelItem = { type: 'result' } | { type: 'table-data'; tabId: string }

export interface SingleResultState {
  resultStatus: ExecutionStatus
  columns: ColumnMeta[]
  totalRows: number
  viewRowCount: number
  viewVersion: number
  latestKnownViewVersion: number
  viewRequestSeq: number
  truncated: boolean
  rowCeiling: number
  appliedRowLimit: number | null
  fullExportBlockedReason: FullExportBlockedReason | null
  executionTimeMs: number
  totalTimeMs: number
  affectedRows: number
  queryId: string | null
  rowLimit: number
  autoLimitApplied: boolean
  errorMessage: string | null
  viewMode: ViewMode
  sortColumn: string | null
  sortDirection: 'asc' | 'desc' | null
  selectedRowIndex: number | null
  checkedRanges: ViewRange[]
  checkedViewVersion: number
  exportDialogOpen: boolean
  preferredExportScope: ExportRowScope
  lastExecutedSql: string | null
  reExecutable: boolean
  isAnalyzed: boolean
  selectedCell: SelectedCellInfo | null

  filterModel: FilterCondition[]
  isFiltering: boolean
  viewError: string | null
  pendingWindowRange: ViewRange | null
  failedWindowRange: ViewRange | null
  rowActionProgress: RowActionProgress | null

  editMode: string | null
  editTableMetadata: Record<string, QueryTableEditInfo>
  editForeignKeys: ForeignKeyColumnInfo[]
  editState: RowEditState | null
  isAnalyzingQuery: boolean
  editableColumnMap: Map<number, boolean>
  editColumnBindings: Map<number, string>
  editBoundColumnIndexMap: Map<string, number>
  saveError: string | null
  isStale: boolean
  editConnectionId: string | null
  editingRowIndex: number | null
  editingBaseIndex: number | null
  draftRow: unknown[] | null

  scrollRow: number
  scrollCol: number
  isExpired: boolean
  rowResidency: FrontendRowResidencyState
  rowsEvictedAt: number | null
  isSorting: boolean
}

export interface TabQueryState {
  content: string
  selectedText: string
  filePath: string | null
  tabStatus: TabStatus
  prevTabStatus: ExecutionStatus
  cursorPosition: { lineNumber: number; column: number } | null
  connectionId: string
  results: SingleResultState[]
  activeResultIndex: number
  activeBottomPanelItem: ActiveBottomPanelItem
  pendingNavigationAction: (() => void) | null
  executionStartedAt: number | null
  isCancelling: boolean
  wasCancelled: boolean
}

export type FlatTabView = TabQueryState & SingleResultState

export interface RowActionHandle {
  update: (done: number) => void
  finish: () => boolean
}

export interface QueryState {
  tabs: Record<string, TabQueryState>

  exportJobs: Record<string, ResultExportJob>

  startFullExport: (tabId: string, request: FullExportRequest) => Promise<void>

  cancelFullExport: (tabId: string) => Promise<void>

  getTabState: (tabId: string) => TabQueryState

  setContent: (tabId: string, content: string) => void

  setSelectedText: (tabId: string, selectedText: string) => void

  setFilePath: (tabId: string, filePath: string | null) => void

  setCursorPosition: (tabId: string, position: { lineNumber: number; column: number }) => void

  executeQuery: (connectionId: string, tabId: string, sql: string) => Promise<void>

  executeMultiQuery: (connectionId: string, tabId: string, statements: string[]) => Promise<void>

  executeCallQuery: (connectionId: string, tabId: string, sql: string) => Promise<void>

  setActiveResultIndex: (tabId: string, index: number) => void

  setActiveBottomPanelItem: (tabId: string, item: ActiveBottomPanelItem) => void

  cleanupTab: (connectionId: string, tabId: string) => void

  cleanupConnection: (connectionId: string, tabIds: string[]) => void

  setViewMode: (tabId: string, mode: ViewMode) => void

  setSelectedRow: (tabId: string, index: number | null) => void

  setCheckedRanges: (tabId: string, ranges: ViewRange[]) => void

  deleteResultRows: (tabId: string) => Promise<number>

  beginRowAction: (tabId: string, action: RowActionStart) => RowActionHandle

  cancelRowAction: (tabId: string) => void

  markResultsExpired: (tabId: string) => void

  markResultExpired: (tabId: string, resultIndex: number) => void

  retryResultWindow: (tabId: string) => void

  retryViewChange: (tabId: string) => void

  setSelectedCell: (tabId: string, cell: SelectedCellInfo | null) => void

  setResultScrollCell: (tabId: string, scrollRow: number, scrollColumn: number) => void

  applyQueryFilters: (tabId: string, resultIndex: number, conditions: FilterCondition[]) => void

  openExportDialog: (tabId: string, scope?: ExportRowScope) => void

  closeExportDialog: (tabId: string) => void

  sortResults: (tabId: string, column: string, direction: 'asc' | 'desc' | null) => Promise<void>

  changeRowLimit: (connectionId: string, tabId: string, size: number) => Promise<void>

  cancelQuery: (connectionId: string, tabId: string) => Promise<void>

  setEditMode: (connectionId: string, tabId: string, tableName: string | null) => Promise<void>

  startEditingRow: (tabId: string, rowIndex: number, row?: CachedRow) => void

  cloneSelectedRow: (tabId: string) => void

  updateCellValue: (tabId: string, resultColumnIndex: number, value: unknown) => void

  syncCellValue: (tabId: string, resultColumnIndex: number, value: unknown) => void

  saveCurrentRow: (tabId: string) => Promise<boolean>

  discardCurrentRow: (tabId: string) => void

  requestNavigationAction: (tabId: string, action: () => void) => void

  confirmNavigation: (tabId: string, shouldSave: boolean) => Promise<void>

  cancelNavigation: (tabId: string) => void

  clearEditState: (tabId: string) => void

  setTabStatus: (tabId: string, status: TabStatus) => void

  validateActiveTabResults: (tabId: string) => void

  retryExpiredResult: (tabId: string) => Promise<void>

  markResultSurfaceActive: (tabId: string, resultIndex?: number) => Promise<void>

  markResultSurfaceInactive: (tabId: string, resultIndex?: number) => void

  evictInactiveResultRows: (tabId: string, resultIndex: number) => void

  restoreEvictedResultRows: (tabId: string, resultIndex?: number) => Promise<void>
}
