import type { FrontendRowResidencyState } from '../../types/schema'
import type {
  QueryState,
  ResultExportJob,
  ResultPatch,
  SingleResultState,
  TabQueryState,
} from './query-state-types'
import { applyViewPatch, mergeViewPatches } from '../data-view/data-view-reducers'
import { hasOpenExportDialog, hasResultAt, hasResults, isSameResultList } from './result-lists'
import { canEvictInactiveView, evictedViewPatch } from '../data-view/residency'
import { withoutKey } from '../../lib/record-utils'

type QueryTabs = Pick<QueryState, 'tabs'>
type ExportJobs = Pick<QueryState, 'exportJobs'>

export interface QueryTabPatch {
  tabId: string
  partial: Partial<TabQueryState>
  fallbackTab: TabQueryState
}

export interface ResultReference {
  tabId: string
  resultIndex: number
}

export interface QueryResultPatch extends ResultReference {
  partial: ResultPatch
}

export interface ResultResidencyPatch extends ResultReference {
  partial: Partial<FrontendRowResidencyState>
}

export interface ResultEviction extends ResultReference {
  evictedAt: number
}

export interface ResultExpiry {
  tabId: string
  isExpired: boolean
}

export interface ExportJobEntry {
  tabId: string
  job: ResultExportJob
}

export interface ExportJobPatch {
  tabId: string
  partial: Partial<ResultExportJob>
}

function withTab(state: QueryTabs, tabId: string, tab: TabQueryState): QueryTabs {
  return { tabs: { ...state.tabs, [tabId]: tab } }
}

function withResults(state: QueryTabs, tabId: string, results: SingleResultState[]): QueryTabs {
  return withTab(state, tabId, { ...state.tabs[tabId], results: results })
}

function withResultUpdated(
  state: QueryTabs,
  { tabId, resultIndex }: ResultReference,
  update: (result: SingleResultState) => SingleResultState
): QueryTabs {
  const tab = state.tabs[tabId]
  if (!hasResultAt(tab, resultIndex)) return state
  const results = [...tab.results]
  results[resultIndex] = update(results[resultIndex])
  return withResults(state, tabId, results)
}

function withEachResultUpdated(
  state: QueryTabs,
  tabId: string,
  update: (result: SingleResultState) => SingleResultState
): QueryTabs {
  const tab = state.tabs[tabId]
  if (!hasResults(tab)) return state
  const results = tab.results.map(update)
  if (isSameResultList(results, tab.results)) return state
  return withResults(state, tabId, results)
}

export function patchQueryTab(
  state: QueryTabs,
  { tabId, partial, fallbackTab }: QueryTabPatch
): QueryTabs {
  const existing = state.tabs[tabId] ?? fallbackTab
  return withTab(state, tabId, { ...existing, ...partial })
}

export function patchedResult(result: SingleResultState, partial: ResultPatch): SingleResultState {
  const { view: viewPatch, ...fields } = partial
  const view = viewPatch ? applyViewPatch(result.view, viewPatch) : result.view
  return { ...result, ...fields, view: view }
}

export function mergeResultPatches(base: ResultPatch, override: ResultPatch): ResultPatch {
  const { view: baseView = {}, ...baseFields } = base
  const { view: overrideView = {}, ...overrideFields } = override
  return { ...baseFields, ...overrideFields, view: mergeViewPatches(baseView, overrideView) }
}

export function patchQueryResult(
  state: QueryTabs,
  { tabId, resultIndex, partial }: QueryResultPatch
): QueryTabs {
  return withResultUpdated(state, { tabId: tabId, resultIndex: resultIndex }, (result) =>
    patchedResult(result, partial)
  )
}

export function patchQueryResultResidency(
  state: QueryTabs,
  { tabId, resultIndex, partial }: ResultResidencyPatch
): QueryTabs {
  return withResultUpdated(state, { tabId: tabId, resultIndex: resultIndex }, (result) =>
    patchedResult(result, {
      view: { residency: { rows: { ...result.view.residency.rows, ...partial } } },
    })
  )
}

function evictedResult(result: SingleResultState, evictedAt: number): SingleResultState {
  if (!canEvictInactiveView(result.view)) return result
  return patchedResult(result, { view: evictedViewPatch(result.view, evictedAt) })
}

export function evictQueryResultRows(
  state: QueryTabs,
  { tabId, resultIndex, evictedAt }: ResultEviction
): QueryTabs {
  const tab = state.tabs[tabId]
  if (!hasResultAt(tab, resultIndex)) return state
  if (!canEvictInactiveView(tab.results[resultIndex].view)) return state
  return withResultUpdated(state, { tabId: tabId, resultIndex: resultIndex }, (result) =>
    evictedResult(result, evictedAt)
  )
}

function isResultExpired(result: SingleResultState): boolean {
  return result.view.residency.isExpired
}

export function setQueryResultsExpired(
  state: QueryTabs,
  { tabId, isExpired }: ResultExpiry
): QueryTabs {
  return withEachResultUpdated(state, tabId, (result) => {
    const isUnchanged = isResultExpired(result) === isExpired
    if (isUnchanged) return result
    return patchedResult(result, { view: { residency: { isExpired: isExpired } } })
  })
}

export function closeQueryExportDialogs(state: QueryTabs, tabId: string): QueryTabs {
  if (!hasOpenExportDialog(state.tabs[tabId])) return state
  return withEachResultUpdated(state, tabId, (result) =>
    result.view.prompts.isExportOpen
      ? patchedResult(result, { view: { prompts: { isExportOpen: false } } })
      : result
  )
}

export function removeQueryTabs(state: QueryTabs, tabIds: string[]): QueryTabs {
  const remainingTabs = { ...state.tabs }
  for (const tabId of tabIds) {
    delete remainingTabs[tabId]
  }
  return { tabs: remainingTabs }
}

export function putExportJob(state: ExportJobs, { tabId, job }: ExportJobEntry): ExportJobs {
  return { exportJobs: { ...state.exportJobs, [tabId]: job } }
}

export function patchExportJob(state: ExportJobs, { tabId, partial }: ExportJobPatch): ExportJobs {
  const job = state.exportJobs[tabId]
  if (!job) return state
  return putExportJob(state, { tabId: tabId, job: { ...job, ...partial } })
}

export function removeExportJob(state: ExportJobs, tabId: string): ExportJobs {
  if (!(tabId in state.exportJobs)) return state
  return { exportJobs: withoutKey(state.exportJobs, tabId) }
}
