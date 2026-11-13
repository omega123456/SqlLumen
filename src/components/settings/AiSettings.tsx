import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '../common/Button'
import { TextInput } from '../common/TextInput'
import { Dropdown } from '../common/Dropdown'
import { ElevatedSurface } from '../common/ElevatedSurface'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { SettingsSection } from './SettingsSection'
import { SettingsToggle } from './SettingsToggle'
import { useSettingsStore, useSettingValue } from '../../stores/settings-store'
import { useSchemaIndexStore, type ConnectionIndexState } from '../../stores/schema-index-store'
import type { AiModelInfo } from '../../lib/ai-commands'
import { ChatCircleTextIcon, DatabaseIcon, CheckIcon } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import { AiMemoriesSettings } from './AiMemoriesSettings'
import { useFetchModels } from '../../hooks/useFetchModels'
import styles from './AiSettings.module.css'
import { isActivationKey } from '../../lib/input-events'
import { isBlank } from '../../lib/value-checks'

// ---------------------------------------------------------------------------
// Local component: ModelCategorySection
// ---------------------------------------------------------------------------

interface ModelCategorySectionProps {
  categoryKey: string
  label: string
  icon: Icon
  models: AiModelInfo[]
  selectedModelId: string
  onSelectModel: (id: string) => void
  emptyText: string
}

function ModelCategorySection({
  categoryKey,
  label,
  icon: IconComponent,
  models,
  selectedModelId,
  onSelectModel,
  emptyText,
}: ModelCategorySectionProps) {
  const labelId = `ai-category-${categoryKey}-label`

  return (
    <div className={styles.categorySection} data-testid={`ai-category-${categoryKey}`}>
      <div className={styles.categoryHeader}>
        <IconComponent size={16} weight="regular" className={styles.categoryIcon} />
        <span
          id={labelId}
          className={styles.categoryLabel}
          data-testid={`ai-category-${categoryKey}-label`}
        >
          {label}
        </span>
        <span className={styles.categoryBadge} data-testid={`ai-category-${categoryKey}-count`}>
          {models.length}
        </span>
      </div>
      {models.length > 0 ? (
        <div
          className={styles.modelGrid}
          data-testid={`ai-${categoryKey}-model-grid`}
          role="radiogroup"
          aria-labelledby={labelId}
        >
          {models.map((model) => (
            <div key={model.id} className={styles.cardWrapper}>
              <ElevatedSurface
                className={`${styles.modelCard}${selectedModelId === model.id ? ` ${styles.modelCardSelected}` : ''}`}
                onClick={() => onSelectModel(model.id)}
                onKeyDown={(event) => {
                  if (isActivationKey(event.key)) {
                    event.preventDefault()
                    onSelectModel(model.id)
                  }
                }}
                tabIndex={0}
                role="radio"
                aria-checked={selectedModelId === model.id}
                data-testid={`ai-model-card-${model.id}`}
                title={model.name ?? model.id}
              >
                {model.name ?? model.id}
              </ElevatedSurface>
              {selectedModelId === model.id && (
                <CheckIcon
                  size={14}
                  weight="bold"
                  className={styles.cardCheckmark}
                  data-testid={`ai-model-check-${model.id}`}
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.categoryEmptyState} data-testid={`ai-${categoryKey}-empty-state`}>
          {emptyText}
        </div>
      )}
    </div>
  )
}

const REMEMBER_SCOPE_OPTIONS = [
  { value: 'connection', label: 'Connection' },
  { value: 'group', label: 'Group' },
  { value: 'global', label: 'Global' },
  { value: 'ask', label: 'Always ask' },
]

const DEFAULT_REMEMBER_SCOPE = 'connection'

type ModelFetch = ReturnType<typeof useFetchModels>
type FetchedModel = ModelFetch['models'][number]

function resolveRememberScope(rememberScopeRaw: string): string {
  const isKnownScope = REMEMBER_SCOPE_OPTIONS.some((option) => option.value === rememberScopeRaw)
  if (isKnownScope) return rememberScopeRaw
  return DEFAULT_REMEMBER_SCOPE
}

function connectionCountLabel(count: number): string {
  if (count === 1) return '1 connection'
  return `${count} connections`
}

function describeBuildingState(buildingConnections: ConnectionIndexState[]): string {
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

interface ModelCategories {
  show: boolean
  chatModels: FetchedModel[]
  embeddingModels: FetchedModel[]
}

// When an embedding URL is set, drive the embedding grid from its dedicated
// fetch (including uncategorised models, since that server may not categorise).
// When blank, fall back to the chat-fetch embedding-category models.
function embeddingModelsFor(
  chatFetch: ModelFetch,
  embeddingFetch: ModelFetch,
  hasEmbeddingUrl: boolean
): FetchedModel[] {
  if (hasEmbeddingUrl) return embeddingFetch.models.filter(isEmbeddingOrUncategorisedModel)
  return chatFetch.models.filter((model) => model.category === 'embedding')
}

// Render the category grids once either fetch has produced models, or when an
// embedding URL is set (so its scoped loading/empty state has a place to live).
function resolveModelCategories(
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

function FetchStatus({
  modelFetch,
  loadingTestId,
  errorTestId,
  loadingText,
}: {
  modelFetch: ModelFetch
  loadingTestId: string
  errorTestId: string
  loadingText: string
}) {
  return (
    <>
      {modelFetch.loading && (
        <div className={styles.modelLoading} data-testid={loadingTestId}>
          {loadingText}
        </div>
      )}
      {modelFetch.error && (
        <div className={styles.modelError} data-testid={errorTestId}>
          {modelFetch.error}
        </div>
      )}
    </>
  )
}

interface ModelSelection {
  chatModel: string
  embeddingModel: string
  onSelectChatModel: (modelId: string) => void
  onSelectEmbeddingModel: (modelId: string) => void
}

interface ModelCategoryGridsProps {
  categories: ModelCategories
  embeddingFetch: ModelFetch
  selection: ModelSelection
}

function ModelCategoryGrids({ categories, embeddingFetch, selection }: ModelCategoryGridsProps) {
  if (!categories.show) return null
  return (
    <div className={styles.categorySections} data-testid="ai-model-categories">
      <ModelCategorySection
        categoryKey="chat"
        label="Chat models"
        icon={ChatCircleTextIcon}
        models={categories.chatModels}
        selectedModelId={selection.chatModel}
        onSelectModel={selection.onSelectChatModel}
        emptyText="No chat models found"
      />

      <div className={styles.sectionDivider} />

      <div className={styles.categorySection} data-testid="ai-embedding-models-region">
        <FetchStatus
          modelFetch={embeddingFetch}
          loadingTestId="ai-embedding-models-loading"
          errorTestId="ai-embedding-models-error"
          loadingText="Loading embedding models..."
        />

        <ModelCategorySection
          categoryKey="embedding"
          label="Embedding models"
          icon={DatabaseIcon}
          models={categories.embeddingModels}
          selectedModelId={selection.embeddingModel}
          onSelectModel={selection.onSelectEmbeddingModel}
          emptyText="No embedding models found"
        />
      </div>
    </div>
  )
}

interface ReindexRowProps {
  buildingConnections: ConnectionIndexState[]
  onRequestReindex: () => void
}

function ReindexRow({ buildingConnections, onRequestReindex }: ReindexRowProps) {
  const isBuilding = buildingConnections.length > 0
  return (
    <div className={styles.reindexRow} data-testid="ai-reindex-row">
      <Button onClick={onRequestReindex} disabled={isBuilding} data-testid="ai-force-reindex-btn">
        {isBuilding ? 'Reindexing...' : 'Force reindex'}
      </Button>
      {isBuilding && (
        <span
          className={styles.reindexStatus}
          data-testid="ai-reindex-status"
          role="status"
          aria-live="polite"
        >
          {describeBuildingState(buildingConnections)}
        </span>
      )}
    </div>
  )
}

interface NumericSettingFieldConfig {
  settingKey: string
  label: string
  id: string
  testId: string
  min: number
  max: number
  step?: string
}

const GENERATION_FIELDS: NumericSettingFieldConfig[] = [
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

const RANKING_FIELDS: NumericSettingFieldConfig[] = [
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

const EXPANSION_FIELDS: NumericSettingFieldConfig[] = [
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

const DEFAULT_ENDPOINT_PLACEHOLDER = 'http://localhost:11434/v1'

function setPendingSetting(settingKey: string, value: string): void {
  useSettingsStore.getState().setPendingChange(settingKey, value)
}

interface NumericSettingFieldProps {
  field: NumericSettingFieldConfig
  disabled: boolean
}

function NumericSettingField({ field, disabled }: NumericSettingFieldProps) {
  const value = useSettingValue(field.settingKey)
  return (
    <div className={styles.compactField}>
      <label htmlFor={field.id} className={styles.fieldLabel}>
        {field.label}
      </label>
      <TextInput
        id={field.id}
        type="number"
        min={field.min}
        max={field.max}
        step={field.step}
        value={value}
        onChange={(event) => setPendingSetting(field.settingKey, event.target.value)}
        disabled={disabled}
        data-testid={field.testId}
        className={styles.compactFieldInput}
      />
    </div>
  )
}

interface NumericSettingGridProps {
  fields: NumericSettingFieldConfig[]
  disabled: boolean
}

function NumericSettingGrid({ fields, disabled }: NumericSettingGridProps) {
  return (
    <div className={styles.compactFieldGrid}>
      {fields.map((field) => (
        <NumericSettingField key={field.settingKey} field={field} disabled={disabled} />
      ))}
    </div>
  )
}

interface SettingSwitchProps {
  settingKey: string
  label: string
  description: string
  isChecked: (value: string) => boolean
  disabled?: boolean
  testId: string
}

function SettingSwitch({
  settingKey,
  label,
  description,
  isChecked,
  disabled,
  testId,
}: SettingSwitchProps) {
  const value = useSettingValue(settingKey)
  return (
    <SettingsToggle
      label={label}
      description={description}
      checked={isChecked(value)}
      onChange={(checked) => setPendingSetting(settingKey, String(checked))}
      disabled={disabled}
      data-testid={testId}
    />
  )
}

function isTrueSetting(value: string): boolean {
  return value === 'true'
}

function isNotFalseSetting(value: string): boolean {
  return value !== 'false'
}

function useBuildingConnections(): ConnectionIndexState[] {
  const connections = useSchemaIndexStore((state) => state.connections)
  return Object.values(connections).filter((indexState) => indexState.status === 'building')
}

async function forceReindexAllSessions(): Promise<void> {
  const store = useSchemaIndexStore.getState()
  const sessionIds = Object.keys(store.sessionToProfile)
  await Promise.all(sessionIds.map((sessionId) => store.forceRebuild(sessionId)))
}

function useModelFetchOnEndpoint(modelFetch: ModelFetch, isFetchEnabled: boolean): void {
  const fetchModels = modelFetch.fetch
  const resetModels = modelFetch.reset
  useEffect(() => {
    if (!isFetchEnabled) {
      resetModels()
      return
    }
    fetchModels()
  }, [isFetchEnabled, fetchModels, resetModels])
}

function useChatModelFetchOnEndpoint(modelFetch: ModelFetch, isFetchEnabled: boolean): void {
  const fetchModels = modelFetch.fetch
  useEffect(() => {
    if (isFetchEnabled) {
      fetchModels()
    }
  }, [isFetchEnabled, fetchModels])
}

function hasEnabledEndpoint(aiEnabled: boolean, endpoint: string): boolean {
  return aiEnabled && !isBlank(endpoint)
}

interface EndpointFieldProps {
  settingKey: string
  id: string
  label: string
  placeholder: string
  disabled: boolean
  children?: ReactNode
}

function EndpointField({
  settingKey,
  id,
  label,
  placeholder,
  disabled,
  children,
}: EndpointFieldProps) {
  const value = useSettingValue(settingKey)
  return (
    <div>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
      </label>
      <TextInput
        id={id}
        value={value}
        onChange={(event) => setPendingSetting(settingKey, event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        data-testid={id}
        style={{ width: 360 }}
      />
      {children}
    </div>
  )
}

interface ModelListSectionProps {
  chatFetch: ModelFetch
  embeddingFetch: ModelFetch
  hasEmbeddingUrl: boolean
  onRequestReindex: () => void
}

function ModelListSection({
  chatFetch,
  embeddingFetch,
  hasEmbeddingUrl,
  onRequestReindex,
}: ModelListSectionProps) {
  const model = useSettingValue('ai.model')
  const embeddingModel = useSettingValue('ai.embeddingModel')
  const buildingConnections = useBuildingConnections()
  const modelCategories = resolveModelCategories(chatFetch, embeddingFetch, hasEmbeddingUrl)
  return (
    <div className={styles.modelListSection} data-testid="ai-model-list-section">
      <p className={styles.helperText} data-testid="ai-helper-text">
        Models will be grouped by type: chat for conversation, embedding for schema search
      </p>

      <FetchStatus
        modelFetch={chatFetch}
        loadingTestId="ai-models-loading"
        errorTestId="ai-models-error"
        loadingText="Loading models..."
      />

      <ModelCategoryGrids
        categories={modelCategories}
        embeddingFetch={embeddingFetch}
        selection={{
          chatModel: model,
          embeddingModel: embeddingModel,
          onSelectChatModel: (modelId) => setPendingSetting('ai.model', modelId),
          onSelectEmbeddingModel: (modelId) => setPendingSetting('ai.embeddingModel', modelId),
        }}
      />

      <ReindexRow buildingConnections={buildingConnections} onRequestReindex={onRequestReindex} />
    </div>
  )
}

interface AiConnectionSectionProps {
  aiEnabled: boolean
  onRequestReindex: () => void
}

function AiConnectionSection({ aiEnabled, onRequestReindex }: AiConnectionSectionProps) {
  const endpoint = useSettingValue('ai.endpoint')
  const embeddingEndpoint = useSettingValue('ai.embeddingEndpoint')
  const chatFetch = useFetchModels(endpoint)
  const embeddingFetch = useFetchModels(embeddingEndpoint)
  useChatModelFetchOnEndpoint(chatFetch, hasEnabledEndpoint(aiEnabled, endpoint))
  useModelFetchOnEndpoint(embeddingFetch, hasEnabledEndpoint(aiEnabled, embeddingEndpoint))

  const chatUrl = endpoint.trim()
  const embeddingUrl = embeddingEndpoint.trim()
  const hasEmbeddingUrl = embeddingUrl.length > 0
  const hasAnyUrl = Boolean(chatUrl || embeddingUrl)
  const showsModelList = aiEnabled && hasAnyUrl

  return (
    <SettingsSection
      title="Connection"
      description="Configure the base URLs for an OpenAI-compatible service (e.g. Ollama, Jan, vLLM). Enter base URLs only — paths like /chat/completions are appended automatically. A separate embedding URL is optional."
    >
      <EndpointField
        settingKey="ai.endpoint"
        id="settings-ai-endpoint"
        label="Chat Base URL"
        placeholder={DEFAULT_ENDPOINT_PLACEHOLDER}
        disabled={!aiEnabled}
      />

      <EndpointField
        settingKey="ai.embeddingEndpoint"
        id="settings-ai-embedding-endpoint"
        label="Embedding Base URL (optional)"
        placeholder={chatUrl || DEFAULT_ENDPOINT_PLACEHOLDER}
        disabled={!aiEnabled}
      >
        <p className={styles.helperText} data-testid="ai-embedding-helper-text">
          When blank, the chat URL is used for embeddings. Fill this in only if your embedding
          provider is hosted at a different address.
        </p>
      </EndpointField>

      {showsModelList && (
        <ModelListSection
          chatFetch={chatFetch}
          embeddingFetch={embeddingFetch}
          hasEmbeddingUrl={hasEmbeddingUrl}
          onRequestReindex={onRequestReindex}
        />
      )}
    </SettingsSection>
  )
}

function AiGenerationSection({ aiEnabled }: { aiEnabled: boolean }) {
  return (
    <SettingsSection title="Generation" description="Control how the AI generates responses.">
      <NumericSettingGrid fields={GENERATION_FIELDS} disabled={!aiEnabled} />
      <SettingSwitch
        settingKey="ai.enableReasoning"
        label="Enable reasoning / thinking"
        description="When enabled, the AI's chain-of-thought reasoning is shown in a collapsible block above each response. Disable to hide reasoning output entirely."
        isChecked={isNotFalseSetting}
        disabled={!aiEnabled}
        testId="settings-ai-enable-reasoning"
      />
      <SettingSwitch
        settingKey="ai.preferResponsesApi"
        label="Use Responses API when reasoning is enabled"
        description="Off by default for better local provider compatibility and prompt cache reuse. Turn on only if your endpoint supports the Responses API well."
        isChecked={isTrueSetting}
        disabled={!aiEnabled}
        testId="settings-ai-prefer-responses-api"
      />
    </SettingsSection>
  )
}

function AiRetrievalSection({ aiEnabled }: { aiEnabled: boolean }) {
  return (
    <SettingsSection
      title="AI retrieval"
      description="Control how schema context is retrieved and ranked for AI queries."
    >
      <NumericSettingGrid fields={RANKING_FIELDS} disabled={!aiEnabled} />
      <SettingSwitch
        settingKey="ai.retrieval.rerankEnabled"
        label="LLM re-rank"
        description="Use the chat model to re-rank retrieval results (slower, may improve relevance)."
        isChecked={isTrueSetting}
        disabled={!aiEnabled}
        testId="settings-ai-retrieval-rerank"
      />
      <SettingSwitch
        settingKey="ai.retrieval.hydeEnabled"
        label="HyDE (Hypothetical SQL)"
        description="Generate a hypothetical SQL fragment as an extra search query for improved retrieval."
        isChecked={isNotFalseSetting}
        disabled={!aiEnabled}
        testId="settings-ai-retrieval-hyde"
      />
      <NumericSettingGrid fields={EXPANSION_FIELDS} disabled={!aiEnabled} />
    </SettingsSection>
  )
}

function AiMemorySection({ aiEnabled }: { aiEnabled: boolean }) {
  const rememberScope = resolveRememberScope(useSettingValue('ai.rememberScope'))
  return (
    <SettingsSection title="Memory" description="Choose which scope /remember saves to by default.">
      <div>
        <span id="settings-ai-remember-scope-label" className={styles.fieldLabel}>
          Default /remember scope
        </span>
        <Dropdown
          id="settings-ai-remember-scope"
          labelledBy="settings-ai-remember-scope-label"
          options={REMEMBER_SCOPE_OPTIONS}
          value={rememberScope}
          onChange={(value) => setPendingSetting('ai.rememberScope', value)}
          disabled={!aiEnabled}
          data-testid="settings-ai-remember-scope"
        />
      </div>
    </SettingsSection>
  )
}

interface ForceReindexDialogProps {
  isOpen: boolean
  onClose: () => void
}

function ForceReindexDialog({ isOpen, onClose }: ForceReindexDialogProps) {
  const isBuilding = useBuildingConnections().length > 0
  const confirmReindex = () => {
    forceReindexAllSessions().finally(onClose)
  }
  return (
    <ConfirmDialog
      isOpen={isOpen}
      title="Force reindex vector DB"
      message="This will wipe the current schema index and rebuild it from scratch for all active connections. This may take a few minutes."
      confirmLabel="Reindex"
      isDestructive
      warningText={null}
      isLoading={isBuilding}
      onConfirm={confirmReindex}
      onCancel={onClose}
    />
  )
}

export function AiSettings() {
  const aiEnabled = useSettingValue('ai.enabled') === 'true'
  const [reindexConfirmOpen, setReindexConfirmOpen] = useState(false)

  return (
    <div data-testid="settings-ai">
      <SettingsSection title="Enable AI" description="Turn the AI assistant on or off.">
        <SettingSwitch
          settingKey="ai.enabled"
          label="Enable AI assistant"
          description="Allow AI-powered features such as query suggestions and natural language queries."
          isChecked={isTrueSetting}
          testId="settings-ai-enabled"
        />
      </SettingsSection>

      <div className={!aiEnabled ? styles.disabledGroup : undefined}>
        <AiConnectionSection
          aiEnabled={aiEnabled}
          onRequestReindex={() => setReindexConfirmOpen(true)}
        />
        <AiGenerationSection aiEnabled={aiEnabled} />
        <AiRetrievalSection aiEnabled={aiEnabled} />
        <AiMemorySection aiEnabled={aiEnabled} />
      </div>

      <AiMemoriesSettings />

      <ForceReindexDialog
        isOpen={reindexConfirmOpen}
        onClose={() => setReindexConfirmOpen(false)}
      />
    </div>
  )
}
