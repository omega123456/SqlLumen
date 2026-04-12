import { useCallback, useRef, useState } from 'react'
import { TextInput } from '../common/TextInput'
import { Button } from '../common/Button'
import { ElevatedSurface } from '../common/ElevatedSurface'
import { SettingsSection } from './SettingsSection'
import { SettingsToggle } from './SettingsToggle'
import { useSettingsStore, useSettingValue } from '../../stores/settings-store'
import { listAiModels } from '../../lib/ai-commands'
import type { AiModelInfo } from '../../lib/ai-commands'
import styles from './AiSettings.module.css'

export function AiSettings() {
  const setPendingChange = useSettingsStore((s) => s.setPendingChange)

  const aiEnabled = useSettingValue('ai.enabled') === 'true'
  const endpoint = useSettingValue('ai.endpoint')
  const model = useSettingValue('ai.model')
  const temperature = useSettingValue('ai.temperature')
  const maxTokens = useSettingValue('ai.maxTokens')

  const [availableModels, setAvailableModels] = useState<AiModelInfo[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)

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

  function handleSelectModel(modelId: string) {
    setPendingChange('ai.model', modelId)
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
          description="Configure the endpoint and model for a local/self-hosted LLM (e.g. Ollama, LM Studio, Jan)."
        >
          <div>
            <label htmlFor="settings-ai-endpoint" className={styles.fieldLabel}>
              Endpoint URL
            </label>
            <TextInput
              id="settings-ai-endpoint"
              value={endpoint}
              onChange={(e) => setPendingChange('ai.endpoint', e.target.value)}
              placeholder="http://localhost:11434/v1/chat/completions"
              disabled={!aiEnabled}
              data-testid="settings-ai-endpoint"
              style={{ width: 360 }}
            />
          </div>
          <div>
            <label htmlFor="settings-ai-model" className={styles.fieldLabel}>
              Model name
            </label>
            <TextInput
              id="settings-ai-model"
              value={model}
              onChange={(e) => setPendingChange('ai.model', e.target.value)}
              placeholder="codellama"
              disabled={!aiEnabled}
              data-testid="settings-ai-model"
              style={{ width: 260 }}
            />
          </div>

          {aiEnabled && endpoint.trim() && (
            <div className={styles.modelListSection} data-testid="ai-model-list-section">
              <div className={styles.modelListHeader}>
                <span className={styles.modelListLabel}>Or select from available models:</span>
                <Button
                  variant="secondary"
                  onClick={handleFetchModels}
                  disabled={loadingModels}
                  data-testid="ai-fetch-models-btn"
                  style={{ fontSize: 'var(--type-size-sm)', padding: '4px 10px' }}
                >
                  {loadingModels ? 'Fetching...' : 'Fetch models'}
                </Button>
              </div>

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
                <div className={styles.modelGrid} data-testid="ai-model-grid">
                  {availableModels.map((m) => (
                    <ElevatedSurface
                      key={m.id}
                      className={`${styles.modelCard}${model === m.id ? ` ${styles.modelCardSelected}` : ''}`}
                      onClick={() => handleSelectModel(m.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleSelectModel(m.id)
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      data-testid={`ai-model-card-${m.id}`}
                      title={m.name ?? m.id}
                    >
                      {m.name ?? m.id}
                    </ElevatedSurface>
                  ))}
                </div>
              )}
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
      </div>
    </div>
  )
}
