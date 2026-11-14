import { useSettingsStore } from '../../../stores/settings-store'
import { useSchemaIndexStore, type ConnectionIndexState } from '../../../stores/schema-index-store'
import type { useFetchModels } from '../../../hooks/useFetchModels'
import { isBlank } from '../../../lib/value-checks'

export const REMEMBER_SCOPE_OPTIONS = [
  { value: 'connection', label: 'Connection' },
  { value: 'group', label: 'Group' },
  { value: 'global', label: 'Global' },
  { value: 'ask', label: 'Always ask' },
]

const DEFAULT_REMEMBER_SCOPE = 'connection'

export type ModelFetch = ReturnType<typeof useFetchModels>
export type FetchedModel = ModelFetch['models'][number]

export function resolveRememberScope(rememberScopeRaw: string): string {
  const isKnownScope = REMEMBER_SCOPE_OPTIONS.some((option) => option.value === rememberScopeRaw)
  if (isKnownScope) return rememberScopeRaw
  return DEFAULT_REMEMBER_SCOPE
}

function connectionCountLabel(count: number): string {
  if (count === 1) return '1 connection'
  return `${count} connections`
}

export function describeBuildingState(buildingConnections: ConnectionIndexState[]): string {
  const countLabel = connectionCountLabel(buildingConnections.length)
  if (buildingConnections.length === 0) return `Reading schema (${countLabel})...`
  const first = buildingConnections[0]
  const hasTableTotals = first.tablesTotal > 0
  const isFinalizingTables = first.phase === 'finalizing' && hasTableTotals
  if (isFinalizingTables) {
    return `Finalizing ${first.tablesDone}/${first.tablesTotal} steps (${countLabel})...`
  }
  const isEmbeddingTables = first.phase === 'embedding' && hasTableTotals
  if (isEmbeddingTables) {
    return `Indexing ${first.tablesDone}/${first.tablesTotal} tables (${countLabel})...`
  }
  const isReadingTables = first.phase === 'loading_schema' && first.tablesDone > 0
  if (isReadingTables) {
    return `Reading schema (${first.tablesDone} tables, ${countLabel})...`
  }
  return `Reading schema (${countLabel})...`
}

function isChatModel(model: FetchedModel): boolean {
  return model.category === 'chat' || !model.category
}

function isEmbeddingOrUncategorisedModel(model: FetchedModel): boolean {
  return model.category === 'embedding' || !model.category
}

export interface ModelCategories {
  show: boolean
  chatModels: FetchedModel[]
  embeddingModels: FetchedModel[]
}

function embeddingModelsFor(
  chatFetch: ModelFetch,
  embeddingFetch: ModelFetch,
  hasEmbeddingUrl: boolean
): FetchedModel[] {
  if (hasEmbeddingUrl) return embeddingFetch.models.filter(isEmbeddingOrUncategorisedModel)
  return chatFetch.models.filter((model) => model.category === 'embedding')
}

export function resolveModelCategories(
  chatFetch: ModelFetch,
  embeddingFetch: ModelFetch,
  hasEmbeddingUrl: boolean
): ModelCategories {
  const hasFetchedModels = chatFetch.models.length > 0 || embeddingFetch.models.length > 0
  return {
    show: hasFetchedModels || hasEmbeddingUrl,
    chatModels: chatFetch.models.filter(isChatModel),
    embeddingModels: embeddingModelsFor(chatFetch, embeddingFetch, hasEmbeddingUrl),
  }
}

export interface NumericSettingFieldConfig {
  settingKey: string
  label: string
  id: string
  testId: string
  min: number
  max: number
  step?: string
}

export const GENERATION_FIELDS: NumericSettingFieldConfig[] = [
  {
    settingKey: 'ai.temperature',
    label: 'Temperature',
    id: 'settings-ai-temperature',
    testId: 'settings-ai-temperature',
    min: 0,
    max: 2,
    step: '0.1',
  },
  {
    settingKey: 'ai.maxTokens',
    label: 'Max tokens',
    id: 'settings-ai-max-tokens',
    testId: 'settings-ai-max-tokens',
    min: 1,
    max: 128000,
  },
]

export const RANKING_FIELDS: NumericSettingFieldConfig[] = [
  {
    settingKey: 'ai.retrieval.topKPerQuery',
    label: 'Top-K per query',
    id: 'settings-ai-topk',
    testId: 'settings-ai-retrieval-topk',
    min: 1,
    max: 100,
  },
  {
    settingKey: 'ai.retrieval.topN',
    label: 'Top-N results',
    id: 'settings-ai-topn',
    testId: 'settings-ai-retrieval-topn',
    min: 1,
    max: 100,
  },
  {
    settingKey: 'ai.retrieval.fkFanoutCap',
    label: 'FK fan-out cap',
    id: 'settings-ai-fk-fanout',
    testId: 'settings-ai-retrieval-fk-fanout',
    min: 0,
    max: 200,
  },
  {
    settingKey: 'ai.retrieval.lexicalWeight',
    label: 'Lexical weight (λ)',
    id: 'settings-ai-lexical-weight',
    testId: 'settings-ai-retrieval-lexical-weight',
    min: 0,
    max: 2,
    step: '0.05',
  },
  {
    settingKey: 'ai.retrieval.tokenBudget',
    label: 'Token budget',
    id: 'settings-ai-token-budget',
    testId: 'settings-ai-retrieval-token-budget',
    min: 500,
    max: 100000,
  },
]

export const EXPANSION_FIELDS: NumericSettingFieldConfig[] = [
  {
    settingKey: 'ai.retrieval.expansionMaxQueries',
    label: 'Max expansion queries',
    id: 'settings-ai-expansion-max',
    testId: 'settings-ai-retrieval-expansion-max',
    min: 2,
    max: 20,
  },
  {
    settingKey: 'ai.retrieval.graphDepth',
    label: 'Graph walk depth',
    id: 'settings-ai-graph-depth',
    testId: 'settings-ai-retrieval-graph-depth',
    min: 1,
    max: 3,
  },
  {
    settingKey: 'ai.retrieval.feedbackBoost',
    label: 'Feedback boost (μ)',
    id: 'settings-ai-feedback-boost',
    testId: 'settings-ai-retrieval-feedback-boost',
    min: 0,
    max: 1,
    step: '0.05',
  },
  {
    settingKey: 'ai.retrieval.recentQueryWindow',
    label: 'Recent query window',
    id: 'settings-ai-recent-window',
    testId: 'settings-ai-retrieval-recent-window',
    min: 1,
    max: 100,
  },
]

export const DEFAULT_ENDPOINT_PLACEHOLDER = 'http://localhost:11434/v1'

export function setPendingSetting(settingKey: string, value: string): void {
  useSettingsStore.getState().setPendingChange(settingKey, value)
}

export function isTrueSetting(value: string): boolean {
  return value === 'true'
}

export function isNotFalseSetting(value: string): boolean {
  return value !== 'false'
}

export async function forceReindexAllSessions(): Promise<void> {
  const store = useSchemaIndexStore.getState()
  const sessionIds = Object.keys(store.sessionToProfile)
  await Promise.all(sessionIds.map((sessionId) => store.forceRebuild(sessionId)))
}

export function hasEnabledEndpoint(aiEnabled: boolean, endpoint: string): boolean {
  return aiEnabled && !isBlank(endpoint)
}
