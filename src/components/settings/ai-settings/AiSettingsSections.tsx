import { useFetchModels } from '../../../hooks/useFetchModels'
import { Dropdown } from '../../common/Dropdown'
import { SettingsSection } from '../SettingsSection'
import { useSettingValue } from '../../../stores/settings-store'
import {
  DEFAULT_ENDPOINT_PLACEHOLDER,
  EXPANSION_FIELDS,
  GENERATION_FIELDS,
  RANKING_FIELDS,
  REMEMBER_SCOPE_OPTIONS,
  hasEnabledEndpoint,
  isNotFalseSetting,
  isTrueSetting,
  resolveModelCategories,
  resolveRememberScope,
  setPendingSetting,
  type ModelFetch,
} from './ai-settings-model'
import {
  useBuildingConnections,
  useChatModelFetchOnEndpoint,
  useModelFetchOnEndpoint,
} from './use-ai-model-fetch'
import { FetchStatus, ModelCategoryGrids } from './ModelCategoryGrids'
import { EndpointField, NumericSettingGrid, ReindexRow, SettingSwitch } from './AiSettingControls'
import styles from '../AiSettings.module.css'

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

export function AiConnectionSection({ aiEnabled, onRequestReindex }: AiConnectionSectionProps) {
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

export function AiGenerationSection({ aiEnabled }: { aiEnabled: boolean }) {
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

export function AiRetrievalSection({ aiEnabled }: { aiEnabled: boolean }) {
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

export function AiMemorySection({ aiEnabled }: { aiEnabled: boolean }) {
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
