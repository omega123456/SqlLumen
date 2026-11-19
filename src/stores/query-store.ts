import { create } from 'zustand'
import { queryTabActions } from './query-store/query-tab-actions'
import { queryRunActions } from './query-store/query-run'
import { runAndCopyActions } from './query-store/run-and-copy'
import { queryRerunActions } from './query-store/query-rerun'
import { expiredResultActions } from './query-store/expired-results'
import { resultResidencyActions } from './query-store/result-residency-actions'
import { resultViewActions } from './query-store/result-view-actions'
import { fullExportActions } from './query-store/full-export'
import { rowEditModeActions } from './query-store/row-edit-mode'
import { queryDataViewActions } from './query-store/query-data-view-actions'
import { registerQueryDataViewRoute } from './query-store/query-data-view-route'
import { registerDataViewWindowHandlers } from './data-view/window-handlers'
import type { QueryState } from './query-store/query-state-types'

export { stripLeadingSqlComments } from '../lib/sql-utils'
export {
  FALLBACK_ROW_LIMIT,
  getDefaultRowLimit,
  RESULT_EXPORT_POLL_MS,
  DEFAULT_RESULT_STATE,
} from './query-store/query-state-defaults'
export {
  isEditableSelectSql,
  isCallSql,
  isTableDataInBottomPanel,
  activeResultIndexOf,
  getActiveResult,
  hasAnyUnsavedEdits,
  getFlatTabState,
  isExecutionLocked,
} from './query-store/query-tab-selectors'
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
  QueryResultFields,
  ResultPatch,
  TabQueryState,
  FlatTabView,
  RowActionHandle,
  QueryState,
  RunTarget,
} from './query-store/query-state-types'
export { getResultViewSpec } from './query-store/result-view-spec'
export { activeQuerySurfaceRef, querySurfaceRef } from './query-store/query-surface'

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
  ...rowEditModeActions(),
  ...queryDataViewActions(),
}))

registerQueryDataViewRoute()
registerDataViewWindowHandlers()
