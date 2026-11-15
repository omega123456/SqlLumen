import { useState } from 'react'
import { SettingsSection } from './SettingsSection'
import { useSettingValue } from '../../stores/settings-store'
import { AiMemoriesSettings } from './AiMemoriesSettings'
import { isTrueSetting } from './ai-settings/ai-settings-model'
import { ForceReindexDialog, SettingSwitch } from './ai-settings/AiSettingControls'
import {
  AiConnectionSection,
  AiGenerationSection,
  AiMemorySection,
  AiRetrievalSection,
} from './ai-settings/AiSettingsSections'

type AiGroupState = 'enabled' | 'disabled'

const AI_GROUP_STATE_CLASSES: Record<AiGroupState, string> = {
  enabled: '',
  disabled: 'pointer-events-none opacity-50',
}

function aiGroupStateOf(aiEnabled: boolean): AiGroupState {
  if (aiEnabled) return 'enabled'
  return 'disabled'
}

export function AiSettings() {
  const aiEnabled = useSettingValue('ai.enabled') === 'true'
  const groupState = aiGroupStateOf(aiEnabled)
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

      <div className={AI_GROUP_STATE_CLASSES[groupState]} data-state={groupState}>
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
