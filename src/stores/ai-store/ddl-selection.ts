import { logFrontend } from '../../lib/app-log-commands'
import { estimateTokenCount } from '../../lib/schema-ddl-compactor'
import type { AiMessage, TabAiState } from '../ai-store'
import { MEMORY_TOKEN_BUDGET } from './memory-retrieval'
import { readPositiveIntegerSetting } from './schema-retrieval'
import type { SemanticSearchResult } from './schema-retrieval'

const CUMULATIVE_SCHEMA_TOKEN_BUDGET_DEFAULT = 30000

const DEFAULT_RETRIEVAL_TOKEN_BUDGET = 6000

const CHUNK_TYPE_SORT_ORDER: Record<string, number> = { table: 0, view: 1, fk: 3 }

const OTHER_CHUNK_TYPE_SORT_ORDER = 2

function chunkTypeSortOrder(chunkType: string): number {
  return CHUNK_TYPE_SORT_ORDER[chunkType] ?? OTHER_CHUNK_TYPE_SORT_ORDER
}

export function logSemanticSearchResults(results: SemanticSearchResult[]): void {
  const summary = results.map((result) => ({
    chunkKey: result.chunkKey,
    dbName: result.dbName,
    tableName: result.tableName,
    chunkType: result.chunkType,
    score: result.score,
  }))
  logFrontend(
    'debug',
    `[ai-store] semantic search returned ${results.length} result(s): ${JSON.stringify(summary)}`
  )
}

interface DdlBudget {
  perTurnTokens: number
  remainingCumulativeTokens: number
  providedChunkKeys: Record<string, boolean>
}

export function resolveDdlBudget(tab: TabAiState | undefined): DdlBudget {
  const tokenBudget = readPositiveIntegerSetting(
    'ai.retrieval.tokenBudget',
    DEFAULT_RETRIEVAL_TOKEN_BUDGET
  )
  const cumulativeBudget = Math.max(CUMULATIVE_SCHEMA_TOKEN_BUDGET_DEFAULT, tokenBudget)
  const usedCumulativeTokens = tab?.cumulativeSchemaTokens ?? 0
  return {
    perTurnTokens: Math.max(tokenBudget - MEMORY_TOKEN_BUDGET, 0),
    remainingCumulativeTokens: Math.max(cumulativeBudget - usedCumulativeTokens, 0),
    providedChunkKeys: tab?.providedChunkKeys ?? {},
  }
}

function compareSearchResults(left: SemanticSearchResult, right: SemanticSearchResult): number {
  const leftOrder = chunkTypeSortOrder(left.chunkType)
  const rightOrder = chunkTypeSortOrder(right.chunkType)
  if (leftOrder !== rightOrder) return leftOrder - rightOrder
  return right.score - left.score
}

function exceedsDdlBudget(runningTokens: number, blockTokens: number, budget: DdlBudget): boolean {
  const nextTokens = runningTokens + blockTokens
  const exceedsPerTurnBudget = nextTokens > budget.perTurnTokens && runningTokens > 0
  return exceedsPerTurnBudget || nextTokens > budget.remainingCumulativeTokens
}

interface DdlSelection {
  ddlParts: string[]
  novelChunkKeys: string[]
  tokens: number
  droppedCount: number
}

export function selectNovelDdlChunks(
  results: SemanticSearchResult[],
  budget: DdlBudget
): DdlSelection {
  const sortedResults = [...results].sort(compareSearchResults)
  const seen = new Set<string>()
  const selection: DdlSelection = { ddlParts: [], novelChunkKeys: [], tokens: 0, droppedCount: 0 }
  for (const result of sortedResults) {
    if (seen.has(result.chunkKey)) continue
    seen.add(result.chunkKey)
    if (budget.providedChunkKeys[result.chunkKey]) continue
    const blockTokens = estimateTokenCount(result.ddlText)
    if (exceedsDdlBudget(selection.tokens, blockTokens, budget)) {
      selection.droppedCount++
      break
    }
    selection.tokens += blockTokens
    selection.ddlParts.push(result.ddlText)
    selection.novelChunkKeys.push(result.chunkKey)
  }
  return selection
}

export function logDdlSelection(selection: DdlSelection, ddl: string): void {
  if (selection.droppedCount > 0) {
    logFrontend(
      'debug',
      `[ai-store] token budget: dropped ${selection.droppedCount} chunk(s) exceeding budget`
    )
  }
  logFrontend(
    'debug',
    `[ai-store] DDL assembly complete — novelChunks=${selection.ddlParts.length} totalCharsInDdl=${ddl.length}`
  )
  const ddlState = ddl.length > 0 ? `injected (${ddl.length} chars)` : 'empty (no schema context)'
  logFrontend('debug', `[ai-store] retrieveSchemaContext complete — ddl ${ddlState}`)
}

export function sumSchemaContextTokens(messages: AiMessage[]): number {
  return messages
    .filter((message) => message.kind === 'schema-context')
    .reduce((total, message) => total + estimateTokenCount(message.content), 0)
}
