import type { RetrievalHints } from '../../lib/schema-index-commands'
import { useQueryStore } from '../query-store'
import { useAiFeedbackStore } from '../ai-feedback-store'
import { logFrontend } from '../../lib/app-log-commands'
import { toErrorMessage } from '../../lib/error-message'
import { extractTablesFromSql } from './expansion-parsing'
import { readPositiveIntegerSetting } from './schema-retrieval'

export const DATABASE_AND_TABLE_PART_COUNT = 2

const DEFAULT_RECENT_QUERY_WINDOW = 20

const RECENCY_WEIGHT_DECAY_RANGE = 0.95

function isNonBlankText(text: string | undefined): text is string {
  return Boolean(text?.trim())
}

function keepHeavierWeight(weights: Map<string, number>, key: string, weight: number): void {
  const existingWeight = weights.get(key)
  const isExistingWeightHeavier = existingWeight !== undefined && existingWeight >= weight
  if (isExistingWeightHeavier) return
  weights.set(key, weight)
}

function recentTableHints(recentQueryWindow: number): RetrievalHints['recentTables'] {
  const recentQueries = Object.values(useQueryStore.getState().tabs)
    .map((tab) => tab.content)
    .filter(isNonBlankText)
    .slice(0, recentQueryWindow)
  const tableWeights = new Map<string, number>()
  recentQueries.forEach((sql, index) => {
    const weight = 1.0 - (index / recentQueryWindow) * RECENCY_WEIGHT_DECAY_RANGE
    for (const table of extractTablesFromSql(sql)) {
      keepHeavierWeight(tableWeights, `${table.dbName}.${table.tableName}`, weight)
    }
  })
  const hints: RetrievalHints['recentTables'] = []
  for (const [key, weight] of tableWeights) {
    const [dbName, tableName] = key.split('.')
    if (dbName && tableName) {
      hints.push({ dbName, tableName, weight })
    }
  }
  return hints
}

function acceptedTableHints(sessionId: string): RetrievalHints['acceptedTables'] {
  const feedbackEntries = useAiFeedbackStore.getState().getAcceptedTables(sessionId)
  return feedbackEntries.map((entry) => ({
    dbName: entry.dbName,
    tableName: entry.tableName,
    weight: entry.weight,
  }))
}

export function assembleRetrievalHints(sessionId: string, attachedSql: string): RetrievalHints {
  const hints: RetrievalHints = {
    recentTables: [],
    editorTables: [],
    acceptedTables: [],
  }
  try {
    const recentQueryWindow = readPositiveIntegerSetting(
      'ai.retrieval.recentQueryWindow',
      DEFAULT_RECENT_QUERY_WINDOW
    )
    if (attachedSql) {
      hints.editorTables = extractTablesFromSql(attachedSql)
    }
    hints.acceptedTables = acceptedTableHints(sessionId)
    hints.recentTables = recentTableHints(recentQueryWindow)
    logFrontend(
      'debug',
      `[ai-store] assembled hints — recent=${hints.recentTables.length} editor=${hints.editorTables.length} accepted=${hints.acceptedTables.length}`
    )
  } catch (error) {
    const message = toErrorMessage(error)
    logFrontend('warn', `[ai-store] hint assembly failed (non-fatal): ${message}`)
  }
  return hints
}
