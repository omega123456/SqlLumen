import { describe, expect, it } from 'vitest'
import {
  closeQueryExportDialogs,
  evictQueryResultRows,
  patchExportJob,
  patchQueryResult,
  patchQueryResultResidency,
  patchQueryTab,
  putExportJob,
  removeExportJob,
  removeQueryTabs,
  setQueryResultsExpired,
} from '../../../stores/query-store/query-tab-reducers'
import {
  hasOpenExportDialog,
  hasResultAt,
  hasResults,
} from '../../../stores/query-store/result-lists'
import {
  canEvictInactiveResult,
  shouldScheduleResultEviction,
} from '../../../stores/query-store/result-residency'
import {
  DEFAULT_RESULT_STATE,
  type ResultExportJob,
  type SingleResultState,
  type TabQueryState,
} from '../../../stores/query-store'
import { makeTabState } from '../../helpers/query-test-utils'

const EVICTED_AT = 1_700_000_000_000
const MISSING_RESULT_INDEX = 5

function resultWith(overrides: Partial<SingleResultState> = {}): SingleResultState {
  return { ...DEFAULT_RESULT_STATE, viewRowCount: 3, ...overrides }
}

function tabWith(results: SingleResultState[]): TabQueryState {
  return { ...makeTabState(), results: results }
}

function stateWith(results: SingleResultState[]) {
  return { tabs: { 'tab-1': tabWith(results) } }
}

function exportJob(overrides: Partial<ResultExportJob> = {}): ResultExportJob {
  return {
    connectionId: 'conn-1',
    resultIndex: 0,
    format: 'csv',
    filePath: '/tmp/out.csv',
    includeHeaders: true,
    jobId: null,
    queryId: 'q-1',
    status: 'running',
    progress: null,
    cancelRequested: false,
    error: null,
    startToken: 1,
    ...overrides,
  }
}

describe('query tab reducers', () => {
  it('patches an existing tab and seeds a missing one from the fallback', () => {
    const fallbackTab = makeTabState()
    const state = stateWith([resultWith()])
    const patched = patchQueryTab(state, {
      tabId: 'tab-1',
      partial: { content: 'SELECT 1' },
      fallbackTab: fallbackTab,
    })
    expect(patched.tabs['tab-1'].content).toBe('SELECT 1')
    expect(patched.tabs['tab-1'].results).toBe(state.tabs['tab-1'].results)
    const seeded = patchQueryTab(
      { tabs: {} },
      { tabId: 'tab-2', partial: { content: 'x' }, fallbackTab: fallbackTab }
    )
    expect(seeded.tabs['tab-2']).toEqual({ ...fallbackTab, content: 'x' })
  })

  it('patches one result and ignores a result index that does not exist', () => {
    const state = stateWith([resultWith(), resultWith()])
    const patched = patchQueryResult(state, {
      tabId: 'tab-1',
      resultIndex: 1,
      partial: { exportDialogOpen: true },
    })
    expect(patched.tabs['tab-1'].results.map((result) => result.exportDialogOpen)).toEqual([
      false,
      true,
    ])
    expect(
      patchQueryResult(state, { tabId: 'tab-1', resultIndex: MISSING_RESULT_INDEX, partial: {} })
    ).toBe(state)
    expect(patchQueryResult(state, { tabId: 'missing', resultIndex: 0, partial: {} })).toBe(state)
  })

  it('patches the residency of one result', () => {
    const state = stateWith([resultWith()])
    const patched = patchQueryResultResidency(state, {
      tabId: 'tab-1',
      resultIndex: 0,
      partial: { isActive: true },
    })
    expect(patched.tabs['tab-1'].results[0].rowResidency).toEqual({
      ...DEFAULT_RESULT_STATE.rowResidency,
      isActive: true,
    })
  })

  it('evicts the rows of an inactive resident result', () => {
    const inactive = resultWith({
      rowResidency: { status: 'resident', isActive: false, inactiveSince: 1 },
      editingRowIndex: 2,
    })
    const evicted = evictQueryResultRows(stateWith([inactive]), {
      tabId: 'tab-1',
      resultIndex: 0,
      evictedAt: EVICTED_AT,
    })
    expect(evicted.tabs['tab-1'].results[0]).toMatchObject({
      editingRowIndex: null,
      editState: null,
      rowsEvictedAt: EVICTED_AT,
      rowResidency: { status: 'evicted', isActive: false },
    })
  })

  it('does not evict an active, expired or missing result', () => {
    const eviction = { tabId: 'tab-1', resultIndex: 0, evictedAt: EVICTED_AT }
    const active = stateWith([
      resultWith({ rowResidency: { status: 'resident', isActive: true, inactiveSince: null } }),
    ])
    expect(evictQueryResultRows(active, eviction)).toBe(active)
    const expired = stateWith([resultWith({ isExpired: true })])
    expect(evictQueryResultRows(expired, eviction)).toBe(expired)
    expect(evictQueryResultRows({ tabs: {} }, eviction)).toEqual({ tabs: {} })
  })

  it('marks results expired and clears the flag again', () => {
    const state = stateWith([resultWith(), resultWith({ isExpired: true })])
    const expired = setQueryResultsExpired(state, { tabId: 'tab-1', isExpired: true })
    expect(expired.tabs['tab-1'].results.map((result) => result.isExpired)).toEqual([true, true])
    expect(expired.tabs['tab-1'].results[1]).toBe(state.tabs['tab-1'].results[1])
    expect(setQueryResultsExpired(expired, { tabId: 'tab-1', isExpired: true })).toBe(expired)
    const cleared = setQueryResultsExpired(expired, { tabId: 'tab-1', isExpired: false })
    expect(cleared.tabs['tab-1'].results.map((result) => result.isExpired)).toEqual([false, false])
    expect(setQueryResultsExpired({ tabs: {} }, { tabId: 'tab-1', isExpired: true })).toEqual({
      tabs: {},
    })
  })

  it('closes every open export dialog of a tab', () => {
    const state = stateWith([resultWith({ exportDialogOpen: true }), resultWith()])
    const closed = closeQueryExportDialogs(state, 'tab-1')
    expect(hasOpenExportDialog(closed.tabs['tab-1'])).toBe(false)
    expect(closed.tabs['tab-1'].results[1]).toBe(state.tabs['tab-1'].results[1])
    expect(closeQueryExportDialogs(closed, 'tab-1')).toBe(closed)
  })

  it('removes several tabs at once', () => {
    const state = { tabs: { a: makeTabState(), b: makeTabState(), c: makeTabState() } }
    expect(Object.keys(removeQueryTabs(state, ['a', 'c']).tabs)).toEqual(['b'])
  })

  it('puts, patches and removes an export job', () => {
    const started = putExportJob({ exportJobs: {} }, { tabId: 'tab-1', job: exportJob() })
    const patched = patchExportJob(started, { tabId: 'tab-1', partial: { jobId: 'job-1' } })
    expect(patched.exportJobs['tab-1'].jobId).toBe('job-1')
    expect(patchExportJob(started, { tabId: 'missing', partial: { jobId: 'x' } })).toBe(started)
    expect(removeExportJob(patched, 'tab-1')).toEqual({ exportJobs: {} })
    expect(removeExportJob(patched, 'missing')).toBe(patched)
  })
})

describe('result lists and residency', () => {
  it('detects results by presence and index', () => {
    expect(hasResults(undefined)).toBe(false)
    expect(hasResults(tabWith([]))).toBe(false)
    expect(hasResultAt(tabWith([resultWith()]), 0)).toBe(true)
    expect(hasResultAt(tabWith([resultWith()]), 1)).toBe(false)
    expect(hasResultAt(undefined, 0)).toBe(false)
    expect(hasOpenExportDialog(undefined)).toBe(false)
  })

  it('schedules eviction only for clean resident results that hold rows', () => {
    expect(shouldScheduleResultEviction(resultWith())).toBe(true)
    expect(shouldScheduleResultEviction(resultWith({ viewRowCount: 0 }))).toBe(false)
    expect(shouldScheduleResultEviction(resultWith({ isExpired: true }))).toBe(false)
    const evicted = resultWith({
      rowResidency: { status: 'evicted', isActive: false, inactiveSince: null },
    })
    expect(canEvictInactiveResult(evicted)).toBe(false)
  })
})
