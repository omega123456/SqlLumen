import { create } from 'zustand'
import { queryTabActions } from './query-store/query-tab-actions'
import { queryRunActions } from './query-store/query-run'
import { runAndCopyActions } from './query-store/run-and-copy'
import { queryRerunActions } from './query-store/query-rerun'
import { expiredResultActions } from './query-store/expired-results'
import { resultResidencyActions } from './query-store/result-residency-actions'
import { resultViewActions } from './query-store/result-view-actions'
import { fullExportActions } from './query-store/full-export'
import { rowDeletionActions } from './query-store/row-deletion'
import { rowActionProgressActions } from './query-store/row-action-progress'
import { rowEditModeActions } from './query-store/row-edit-mode'
import { rowEditCellActions } from './query-store/row-edit-cells'
import { rowSaveActions } from './query-store/row-save'
import { navigationGuardActions } from './query-store/navigation-guard'
import { registerResultWindowHandlers } from './query-store/query-store-access'
import type { QueryState } from './query-store/query-state-types'

export { stripLeadingSqlComments } from '../lib/sql-utils'
export {
  FALLBACK_ROW_LIMIT,
  getDefaultRowLimit,
  RESULT_EXPORT_POLL_MS,
  MAX_BULK_DELETE_ROWS,
  BULK_DELETE_WARNING_ROWS,
  TEXT_VIEW_ROW_CAP,
  DEFAULT_RESULT_STATE,
} from './query-store/query-state-defaults'
export {
  isEditableSelectSql,
  isCallSql,
  isTableDataInBottomPanel,
  getActiveResult,
  hasUnsavedModifications,
  hasAnyUnsavedEdits,
  getFlatTabState,
  countRanges,
  isSelectedRowInView,
  cloneSourceRowIndex,
  isExecutionLocked,
} from './query-store/query-tab-selectors'
export { copiedBoundColumnNames } from './query-store/row-edit-builders'
export type {
  ExecutionStatus,
  ExportRowScope,
  FullExportRequest,
  ResultExportJob,
  RowActionVerb,
  RowActionStart,
  RowActionProgress,
  TabStatus,
  ActiveBottomPanelItem,
  SingleResultState,
  TabQueryState,
  FlatTabView,
  RowActionHandle,
  QueryState,
  RunTarget,
} from './query-store/query-state-types'
export { getResultViewSpec } from './query-store/result-view-spec'

export const useQueryStore = create<QueryState>()(() => ({
  tabs: {},
  exportJobs: {},
  ...queryTabActions(),
  ...queryRunActions(),
  ...runAndCopyActions(),
  ...queryRerunActions(),
  ...expiredResultActions(),
  ...resultResidencyActions(),
  ...resultViewActions(),
  ...fullExportActions(),
  ...rowDeletionActions(),
  ...rowActionProgressActions(),
  ...rowEditModeActions(),
  ...rowEditCellActions(),
  ...rowSaveActions(),
  ...navigationGuardActions(),
}))

registerResultWindowHandlers()
