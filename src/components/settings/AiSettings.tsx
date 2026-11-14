import { useState } from 'react'
import { SettingsSection } from './SettingsSection'
import { useSettingValue } from '../../stores/settings-store'
import { AiMemoriesSettings } from './AiMemoriesSettings'
import styles from './AiSettings.module.css'
import { isTrueSetting } from './ai-settings/ai-settings-model'
import { ForceReindexDialog, SettingSwitch } from './ai-settings/AiSettingControls'
import {
  AiConnectionSection,
  AiGenerationSection,
  AiMemorySection,
  AiRetrievalSection,
} from './ai-settings/AiSettingsSections'

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
