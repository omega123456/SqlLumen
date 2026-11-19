import type {
  ExportFormat,
  FilterCondition,
  FullExportBlockedReason,
  SelectedCellInfo,
  ViewMode,
} from '../../types/schema'
import { type CachedRow, type ViewRange } from '../../lib/result-window-cache'
import { type ResultExportProgress, type ResultExportStatus } from '../../lib/export-commands'
import type { RunExportProgress } from '../../types/run-export'
import type {
  DataViewPatch,
  DataViewState,
  DataViewSurfaceRef,
  ExportRowScope,
  RowActionProgress,
  RowActionVerb,
} from '../data-view/data-view-types'

export type ExecutionStatus = 'idle' | 'running' | 'success' | 'error'

export type { ExportRowScope, RowActionVerb, RowActionProgress }

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

export interface RowActionStart {
  verb: RowActionVerb
  total: number
  onCancel?: () => void
}

export type TabStatus = ExecutionStatus | 'ai-pending' | 'ai-reviewing' | 'restoring'

export interface ScrollCell {
  scrollRow: number
  scrollColumn: number
}

export interface ColumnSortChange {
  column: string
  direction: 'asc' | 'desc' | null
}

export type ActiveBottomPanelItem = { type: 'result' } | { type: 'table-data'; tabId: string }

export interface QueryResultFields {
  resultStatus: ExecutionStatus
  latestKnownViewVersion: number
  viewRequestSeq: number
  truncated: boolean
  rowCeiling: number
  exportedRowCount: number | null
  appliedRowLimit: number | null
  fullExportBlockedReason: FullExportBlockedReason | null
  executionTimeMs: number
  totalTimeMs: number
  affectedRows: number
  rowLimit: number
  autoLimitApplied: boolean
  errorMessage: string | null
  lastExecutedSql: string | null
  reExecutable: boolean
  isAnalyzed: boolean
  isAnalyzingQuery: boolean
}

export interface SingleResultState extends QueryResultFields {
  view: DataViewState
}

export type ResultPatch = Partial<QueryResultFields> & { view?: DataViewPatch }

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
  executionStartedAt: number | null
  isCancelling: boolean
  wasCancelled: boolean
  runExport: TabRunExport | null
}

export interface TabRunExport {
  runId: string
  runFilePath: string
  progress: RunExportProgress | null
  isActive: boolean
}

export interface RunTarget {
  connectionId: string
  tabId: string
  statements: string[]
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
  executeAllAndCopyResultPath: (target: RunTarget) => Promise<void>
  copyLastRunFilePath: (tabId: string) => Promise<void>

  executeCallQuery: (connectionId: string, tabId: string, sql: string) => Promise<void>

  setActiveResultIndex: (tabId: string, index: number) => void

  setActiveBottomPanelItem: (tabId: string, item: ActiveBottomPanelItem) => void

  cleanupTab: (connectionId: string, tabId: string) => void

  cleanupConnection: (connectionId: string, tabIds: string[]) => void

  setViewMode: (ref: DataViewSurfaceRef, mode: ViewMode) => void

  setSelectedRow: (ref: DataViewSurfaceRef, index: number | null) => void

  setCheckedRanges: (ref: DataViewSurfaceRef, ranges: ViewRange[]) => void

  deleteResultRows: (ref: DataViewSurfaceRef) => Promise<number>

  beginRowAction: (ref: DataViewSurfaceRef, action: RowActionStart) => RowActionHandle

  cancelRowAction: (ref: DataViewSurfaceRef) => void

  markResultsExpired: (tabId: string) => void

  markResultExpired: (tabId: string, resultIndex: number) => void

  retryResultWindow: (ref: DataViewSurfaceRef) => void

  retryViewChange: (ref: DataViewSurfaceRef) => void

  setSelectedCell: (ref: DataViewSurfaceRef, cell: SelectedCellInfo | null) => void

  setResultScrollCell: (ref: DataViewSurfaceRef, scrollCell: ScrollCell) => void

  setResultColumnWidth: (ref: DataViewSurfaceRef, columnKey: string, width: number) => void

  applyQueryFilters: (ref: DataViewSurfaceRef, conditions: FilterCondition[]) => void

  openExportDialog: (ref: DataViewSurfaceRef, scope?: ExportRowScope) => void

  closeExportDialog: (ref: DataViewSurfaceRef) => void

  sortResults: (ref: DataViewSurfaceRef, sort: ColumnSortChange) => Promise<void>

  changeRowLimit: (connectionId: string, tabId: string, size: number) => Promise<void>

  cancelQuery: (connectionId: string, tabId: string) => Promise<void>

  setEditMode: (ref: DataViewSurfaceRef, tableName: string | null) => Promise<void>

  startEditingRow: (ref: DataViewSurfaceRef, rowIndex: number, row?: CachedRow) => void

  cloneSelectedRow: (ref: DataViewSurfaceRef) => void

  insertDraftRow: (ref: DataViewSurfaceRef) => void

  updateCellValue: (ref: DataViewSurfaceRef, resultColumnIndex: number, value: unknown) => void

  syncCellValue: (ref: DataViewSurfaceRef, resultColumnIndex: number, value: unknown) => void

  saveCurrentRow: (ref: DataViewSurfaceRef) => Promise<boolean>

  discardCurrentRow: (ref: DataViewSurfaceRef) => void

  requestNavigationAction: (ref: DataViewSurfaceRef, action: () => void) => void

  requestTabNavigation: (tabId: string, action: () => void) => void

  confirmNavigation: (ref: DataViewSurfaceRef, shouldSave: boolean) => Promise<void>

  cancelNavigation: (ref: DataViewSurfaceRef) => void

  clearEditState: (ref: DataViewSurfaceRef) => void

  setTabStatus: (tabId: string, status: TabStatus) => void

  validateActiveTabResults: (tabId: string) => void

  retryExpiredResult: (tabId: string) => Promise<void>

  markResultSurfaceActive: (tabId: string, resultIndex?: number) => Promise<void>

  markResultSurfaceInactive: (tabId: string, resultIndex?: number) => void

  evictInactiveResultRows: (tabId: string, resultIndex: number) => void

  restoreEvictedResultRows: (tabId: string, resultIndex?: number) => Promise<void>
}
