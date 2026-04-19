import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../common/Button'
import { TextInput } from '../common/TextInput'
import { ElevatedSurface } from '../common/ElevatedSurface'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { SettingsSection } from './SettingsSection'
import { SettingsToggle } from './SettingsToggle'
import { useSettingsStore, useSettingValue } from '../../stores/settings-store'
import { useSchemaIndexStore, type ConnectionIndexState } from '../../stores/schema-index-store'
import { listAiModels } from '../../lib/ai-commands'
import type { AiModelInfo } from '../../lib/ai-commands'
import { ChatCircleText, Database, Check } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import styles from './AiSettings.module.css'

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
          {models.map((m) => (
            <div key={m.id} className={styles.cardWrapper}>
              <ElevatedSurface
                className={`${styles.modelCard}${selectedModelId === m.id ? ` ${styles.modelCardSelected}` : ''}`}
                onClick={() => onSelectModel(m.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelectModel(m.id)
                  }
                }}
                tabIndex={0}
                role="radio"
                aria-checked={selectedModelId === m.id}
                data-testid={`ai-model-card-${m.id}`}
                title={m.name ?? m.id}
              >
                {m.name ?? m.id}
              </ElevatedSurface>
              {selectedModelId === m.id && (
                <Check
                  size={14}
                  weight="bold"
                  className={styles.cardCheckmark}
                  data-testid={`ai-model-check-${m.id}`}
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

// ---------------------------------------------------------------------------
// AiSettings
// ---------------------------------------------------------------------------

export function AiSettings() {
  const setPendingChange = useSettingsStore((s) => s.setPendingChange)

  const aiEnabled = useSettingValue('ai.enabled') === 'true'
  const endpoint = useSettingValue('ai.endpoint')
  const model = useSettingValue('ai.model')
  const embeddingModel = useSettingValue('ai.embeddingModel')
  const temperature = useSettingValue('ai.temperature')
  const maxTokens = useSettingValue('ai.maxTokens')

  // Retrieval settings
  const topKPerQuery = useSettingValue('ai.retrieval.topKPerQuery')
  const topN = useSettingValue('ai.retrieval.topN')
  const fkFanoutCap = useSettingValue('ai.retrieval.fkFanoutCap')
  const lexicalWeight = useSettingValue('ai.retrieval.lexicalWeight')
  const rerankEnabled = useSettingValue('ai.retrieval.rerankEnabled')
  const tokenBudget = useSettingValue('ai.retrieval.tokenBudget')
  const hydeEnabled = useSettingValue('ai.retrieval.hydeEnabled')
  const expansionMaxQueries = useSettingValue('ai.retrieval.expansionMaxQueries')
  const graphDepth = useSettingValue('ai.retrieval.graphDepth')
  const feedbackBoost = useSettingValue('ai.retrieval.feedbackBoost')
  const recentQueryWindow = useSettingValue('ai.retrieval.recentQueryWindow')

  const [availableModels, setAvailableModels] = useState<AiModelInfo[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [reindexConfirmOpen, setReindexConfirmOpen] = useState(false)

  // Subscribe to the schema index store so the Force Reindex button reflects
  // builds triggered from anywhere (other tabs, settings changes, etc.).
  const connections = useSchemaIndexStore((s) => s.connections)
  const buildingConnections = useMemo<ConnectionIndexState[]>(() => {
    return Object.values(connections).filter((c) => c.status === 'building')
  }, [connections])
  const isBuilding = buildingConnections.length > 0

  const fetchCounterRef = useRef(0)

  const handleFetchModels = useCallback(async () => {
    if (!endpoint.trim()) return
    const thisRequest = ++fetchCounterRef.current
    setLoadingModels(true)
    setModelError(null)
    setAvailableModels([])
    try {
      const result = await listAiModels(endpoint)
      if (thisRequest !== fetchCounterRef.current) return // stale
      if (result.error) {
        setModelError(result.error)
      }
      if (result.models.length === 0 && !result.error) {
        setModelError('No models found at this endpoint.')
      } else {
        setAvailableModels(result.models)
      }
    } catch (err) {
      if (thisRequest !== fetchCounterRef.current) return // stale
      setModelError(err instanceof Error ? err.message : 'Failed to fetch models')
    } finally {
      if (thisRequest === fetchCounterRef.current) {
        setLoadingModels(false)
      }
    }
  }, [endpoint])

  const handleForceReindex = useCallback(async () => {
    const store = useSchemaIndexStore.getState()
    const sessions = Object.keys(store.sessionToProfile)
    try {
      await Promise.all(sessions.map((sid) => store.forceRebuild(sid)))
    } finally {
      // Close the dialog; the button stays disabled while the store still
      // reports any connection in the 'building' state.
      setReindexConfirmOpen(false)
    }
  }, [])

  function describeBuildingState(): string {
    const count = buildingConnections.length
    const first = buildingConnections[0]
    const phase = first?.phase ?? null
    const countLabel = count === 1 ? '1 connection' : `${count} connections`
    if (phase === 'finalizing' && (first?.tablesTotal ?? 0) > 0) {
      return `Finalizing ${first.tablesDone}/${first.tablesTotal} steps (${countLabel})...`
    }
    if (phase === 'embedding' && (first?.tablesTotal ?? 0) > 0) {
      return `Indexing ${first.tablesDone}/${first.tablesTotal} tables (${countLabel})...`
    }
    if (phase === 'loading_schema' && (first?.tablesDone ?? 0) > 0) {
      return `Reading schema (${first.tablesDone} tables, ${countLabel})...`
    }
    return `Reading schema (${countLabel})...`
  }

  useEffect(() => {
    if (aiEnabled && endpoint.trim()) {
      handleFetchModels()
    }
  }, [aiEnabled, endpoint, handleFetchModels])

  const chatModels = availableModels.filter((m) => m.category === 'chat' || !m.category)
  const embeddingModels = availableModels.filter((m) => m.category === 'embedding')

  function handleSelectChatModel(modelId: string) {
    setPendingChange('ai.model', modelId)
  }

  function handleSelectEmbeddingModel(modelId: string) {
    setPendingChange('ai.embeddingModel', modelId)
  }

  return (
    <div data-testid="settings-ai">
      <SettingsSection title="Enable AI" description="Turn the AI assistant on or off.">
        <SettingsToggle
          label="Enable AI assistant"
          description="Allow AI-powered features such as query suggestions and natural language queries."
          checked={aiEnabled}
          onChange={(checked) => setPendingChange('ai.enabled', String(checked))}
          data-testid="settings-ai-enabled"
        />
      </SettingsSection>

      <div className={!aiEnabled ? styles.disabledGroup : undefined}>
        <SettingsSection
          title="Connection"
          description="Configure the base URL and model for an OpenAI-compatible service (e.g. Ollama, Jan, vLLM). Enter the base URL only (e.g. http://localhost:11434/v1) — paths like /chat/completions are appended automatically."
        >
          <div>
            <label htmlFor="settings-ai-endpoint" className={styles.fieldLabel}>
              Base URL
            </label>
            <TextInput
              id="settings-ai-endpoint"
              value={endpoint}
              onChange={(e) => setPendingChange('ai.endpoint', e.target.value)}
              placeholder="http://localhost:11434/v1"
              disabled={!aiEnabled}
              data-testid="settings-ai-endpoint"
              style={{ width: 360 }}
            />
          </div>

          {aiEnabled && endpoint.trim() && (
            <div className={styles.modelListSection} data-testid="ai-model-list-section">
              <p className={styles.helperText} data-testid="ai-helper-text">
                Models will be grouped by type: chat for conversation, embedding for schema search
              </p>

              {loadingModels && (
                <div className={styles.modelLoading} data-testid="ai-models-loading">
                  Loading models...
                </div>
              )}

              {modelError && (
                <div className={styles.modelError} data-testid="ai-models-error">
                  {modelError}
                </div>
              )}

              {availableModels.length > 0 && (
                <div className={styles.categorySections} data-testid="ai-model-categories">
                  <ModelCategorySection
                    categoryKey="chat"
                    label="Chat Models"
                    icon={ChatCircleText}
                    models={chatModels}
                    selectedModelId={model}
                    onSelectModel={handleSelectChatModel}
                    emptyText="No chat models found"
                  />

                  <div className={styles.sectionDivider} />

                  <ModelCategorySection
                    categoryKey="embedding"
                    label="Embedding Models"
                    icon={Database}
                    models={embeddingModels}
                    selectedModelId={embeddingModel}
                    onSelectModel={handleSelectEmbeddingModel}
                    emptyText="No embedding models found"
                  />
                </div>
              )}

              <div className={styles.reindexRow} data-testid="ai-reindex-row">
                <Button
                  variant="secondary"
                  onClick={() => setReindexConfirmOpen(true)}
                  disabled={isBuilding}
                  data-testid="ai-force-reindex-btn"
                >
                  {isBuilding ? 'Reindexing...' : 'Force Reindex'}
                </Button>
                {isBuilding && (
                  <span
                    className={styles.reindexStatus}
                    data-testid="ai-reindex-status"
                    role="status"
                    aria-live="polite"
                  >
                    {describeBuildingState()}
                  </span>
                )}
              </div>
            </div>
          )}
        </SettingsSection>

        <SettingsSection title="Generation" description="Control how the AI generates responses.">
          <div>
            <label htmlFor="settings-ai-temperature" className={styles.fieldLabel}>
              Temperature
            </label>
            <TextInput
              id="settings-ai-temperature"
              type="number"
              min={0}
              max={2}
              step="0.1"
              value={temperature}
              onChange={(e) => setPendingChange('ai.temperature', e.target.value)}
              disabled={!aiEnabled}
              data-testid="settings-ai-temperature"
              style={{ width: 120 }}
            />
          </div>
          <div>
            <label htmlFor="settings-ai-max-tokens" className={styles.fieldLabel}>
              Max tokens
            </label>
            <TextInput
              id="settings-ai-max-tokens"
              type="number"
              min={1}
              max={128000}
              value={maxTokens}
              onChange={(e) => setPendingChange('ai.maxTokens', e.target.value)}
              disabled={!aiEnabled}
              data-testid="settings-ai-max-tokens"
              style={{ width: 120 }}
            />
          </div>
        </SettingsSection>

        <SettingsSection
          title="AI Retrieval"
          description="Control how schema context is retrieved and ranked for AI queries."
        >
          {[
            {
              settingKey: 'ai.retrieval.topKPerQuery',
              label: 'Top-K per query',
              id: 'settings-ai-topk',
              testId: 'settings-ai-retrieval-topk',
              min: 1,
              max: 100,
              value: topKPerQuery,
            },
            {
              settingKey: 'ai.retrieval.topN',
              label: 'Top-N results',
              id: 'settings-ai-topn',
              testId: 'settings-ai-retrieval-topn',
              min: 1,
              max: 100,
              value: topN,
            },
            {
              settingKey: 'ai.retrieval.fkFanoutCap',
              label: 'FK fan-out cap',
              id: 'settings-ai-fk-fanout',
              testId: 'settings-ai-retrieval-fk-fanout',
              min: 0,
              max: 200,
              value: fkFanoutCap,
            },
            {
              settingKey: 'ai.retrieval.lexicalWeight',
              label: 'Lexical weight (λ)',
              id: 'settings-ai-lexical-weight',
              testId: 'settings-ai-retrieval-lexical-weight',
              min: 0,
              max: 2,
              step: '0.05',
              value: lexicalWeight,
            },
            {
              settingKey: 'ai.retrieval.tokenBudget',
              label: 'Token budget',
              id: 'settings-ai-token-budget',
              testId: 'settings-ai-retrieval-token-budget',
              min: 500,
              max: 100000,
              value: tokenBudget,
            },
          ].map((s) => (
            <div key={s.settingKey}>
              <label htmlFor={s.id} className={styles.fieldLabel}>
                {s.label}
              </label>
              <TextInput
                id={s.id}
                type="number"
                min={s.min}
                max={s.max}
                step={s.step}
                value={s.value}
                onChange={(e) => setPendingChange(s.settingKey, e.target.value)}
                disabled={!aiEnabled}
                data-testid={s.testId}
                style={{ width: 120 }}
              />
            </div>
          ))}
          <SettingsToggle
            label="LLM re-rank"
            description="Use the chat model to re-rank retrieval results (slower, may improve relevance)."
            checked={rerankEnabled === 'true'}
            onChange={(checked) => setPendingChange('ai.retrieval.rerankEnabled', String(checked))}
            disabled={!aiEnabled}
            data-testid="settings-ai-retrieval-rerank"
          />
          <SettingsToggle
            label="HyDE (Hypothetical SQL)"
            description="Generate a hypothetical SQL fragment as an extra search query for improved retrieval."
            checked={hydeEnabled !== 'false'}
            onChange={(checked) => setPendingChange('ai.retrieval.hydeEnabled', String(checked))}
            disabled={!aiEnabled}
            data-testid="settings-ai-retrieval-hyde"
          />
          {[
            {
              settingKey: 'ai.retrieval.expansionMaxQueries',
              label: 'Max expansion queries',
              id: 'settings-ai-expansion-max',
              testId: 'settings-ai-retrieval-expansion-max',
              min: 2,
              max: 20,
              value: expansionMaxQueries,
            },
            {
              settingKey: 'ai.retrieval.graphDepth',
              label: 'Graph walk depth',
              id: 'settings-ai-graph-depth',
              testId: 'settings-ai-retrieval-graph-depth',
              min: 1,
              max: 3,
              value: graphDepth,
            },
            {
              settingKey: 'ai.retrieval.feedbackBoost',
              label: 'Feedback boost (μ)',
              id: 'settings-ai-feedback-boost',
              testId: 'settings-ai-retrieval-feedback-boost',
              min: 0,
              max: 1,
              step: '0.05',
              value: feedbackBoost,
            },
            {
              settingKey: 'ai.retrieval.recentQueryWindow',
              label: 'Recent query window',
              id: 'settings-ai-recent-window',
              testId: 'settings-ai-retrieval-recent-window',
              min: 1,
              max: 100,
              value: recentQueryWindow,
            },
          ].map((s) => (
            <div key={s.settingKey}>
              <label htmlFor={s.id} className={styles.fieldLabel}>
                {s.label}
              </label>
              <TextInput
                id={s.id}
                type="number"
                min={s.min}
                max={s.max}
                step={s.step}
                value={s.value}
                onChange={(e) => setPendingChange(s.settingKey, e.target.value)}
                disabled={!aiEnabled}
                data-testid={s.testId}
                style={{ width: 120 }}
              />
            </div>
          ))}
        </SettingsSection>
      </div>

      <ConfirmDialog
        isOpen={reindexConfirmOpen}
        title="Force Reindex Vector DB"
        message="This will wipe the current schema index and rebuild it from scratch for all active connections. This may take a few minutes."
        confirmLabel="Reindex"
        isDestructive
        warningText={null}
        isLoading={isBuilding}
        onConfirm={() => void handleForceReindex()}
        onCancel={() => setReindexConfirmOpen(false)}
      />
    </div>
  )
}
