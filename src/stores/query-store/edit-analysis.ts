import type { QueryTableEditInfo } from '../../types/schema'
import { analyzeQueryForEdit as analyzeQueryForEditCmd } from '../../lib/query-commands'
import { logFrontendError } from '../../lib/app-log-commands'
import type { SingleResultState } from './query-state-types'
import { getActiveIndex, patchResultByIndex, resultAt, getQueryState } from './query-store-access'
import { isEditableSelectSql, needsDeferredAnalysis } from './query-tab-selectors'
import { buildEditTableMetadata } from './result-seeding'

interface BackgroundAnalysisRequest {
  tabId: string
  connectionId: string
  sql: string | null
  queryId: string | null
  resultIndex: number
  hasColumns: boolean
  onFailure: (error: unknown) => void
}

interface DeferredAnalysisRequest {
  tabId: string
  connectionId: string
  result: SingleResultState
  resultIndex: number
}

interface EditAnalysisRun {
  tabId: string
  connectionId: string
  sql: string
  expectedQueryId: string | null
  resultIndex?: number
}

let analysisGeneration = 0

type AnalysisTargetState = 'gone' | 'replaced' | 'current'

function resolveAnalysisTarget(
  tabId: string,
  resultIndex: number,
  expectedQueryId: string | null
): AnalysisTargetState {
  const currentResult = resultAt(tabId, resultIndex)
  if (!currentResult) return 'gone'
  const isReplaced = expectedQueryId !== null && currentResult.view.slot.queryId !== expectedQueryId
  if (isReplaced) return 'replaced'
  return 'current'
}

function clearAnalyzingFlagIfLatest(tabId: string, resultIndex: number, generation: number) {
  if (generation !== analysisGeneration) return
  patchResultByIndex(tabId, resultIndex, { isAnalyzingQuery: false })
}

export async function runEditAnalysis({
  tabId,
  connectionId,
  sql,
  expectedQueryId,
  resultIndex,
}: EditAnalysisRun): Promise<Record<string, QueryTableEditInfo> | null> {
  const generation = ++analysisGeneration
  const targetResultIndex = resultIndex ?? getActiveIndex(tabId)

  patchResultByIndex(tabId, targetResultIndex, { isAnalyzingQuery: true })
  try {
    const raw = await analyzeQueryForEditCmd(connectionId, sql)
    const tables = Array.isArray(raw) ? raw : []
    const target = resolveAnalysisTarget(tabId, targetResultIndex, expectedQueryId)
    if (target === 'gone') return null
    if (target === 'replaced') {
      clearAnalyzingFlagIfLatest(tabId, targetResultIndex, generation)
      return null
    }

    const metadata = buildEditTableMetadata(tables)
    patchResultByIndex(tabId, targetResultIndex, {
      isAnalyzingQuery: false,
      isAnalyzed: true,
      view: { editTarget: { tables: metadata } },
    })
    return metadata
  } catch (error) {
    const target = resolveAnalysisTarget(tabId, targetResultIndex, expectedQueryId)
    if (target === 'gone') return null
    if (target === 'replaced') {
      clearAnalyzingFlagIfLatest(tabId, targetResultIndex, generation)
      return null
    }
    patchResultByIndex(tabId, targetResultIndex, { isAnalyzingQuery: false })
    throw error
  }
}

function launchDeferredAnalysis(request: DeferredAnalysisRequest): void {
  launchBackgroundAnalysis({
    tabId: request.tabId,
    connectionId: request.connectionId,
    sql: request.result.lastExecutedSql,
    queryId: request.result.view.slot.queryId,
    resultIndex: request.resultIndex,
    hasColumns: request.result.view.slot.columns.length > 0,
    onFailure: (error) => logFrontendError('[query-edit] deferred analysis failed:', error),
  })
}

export function launchBackgroundAnalysis(request: BackgroundAnalysisRequest): void {
  if (request.sql === null) return
  const isAnalyzable = request.hasColumns && isEditableSelectSql(request.sql)
  if (!isAnalyzable) return
  runEditAnalysis({
    tabId: request.tabId,
    connectionId: request.connectionId,
    sql: request.sql,
    expectedQueryId: request.queryId,
    resultIndex: request.resultIndex,
  }).catch(request.onFailure)
}

export function launchDeferredAnalysisIfNeeded(tabId: string, resultIndex: number) {
  const afterSwitch = getQueryState().tabs[tabId]
  if (!afterSwitch) return
  const newResult = afterSwitch.results[resultIndex]
  if (!needsDeferredAnalysis(newResult)) return
  launchDeferredAnalysis({
    tabId: tabId,
    connectionId: afterSwitch.connectionId,
    result: newResult,
    resultIndex: resultIndex,
  })
}
