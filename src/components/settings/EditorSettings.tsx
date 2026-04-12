import { Dropdown } from '../common/Dropdown'
import { TextInput } from '../common/TextInput'
import { Slider } from '../common/Slider'
import { SettingsSection } from './SettingsSection'
import { SettingsToggle } from './SettingsToggle'
import { useSettingsStore, useSettingValue } from '../../stores/settings-store'

const FONT_FAMILY_OPTIONS = [
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'Fira Code', label: 'Fira Code' },
  { value: 'Source Code Pro', label: 'Source Code Pro' },
  { value: 'Cascadia Code', label: 'Cascadia Code' },
  { value: 'monospace', label: 'System Mono' },
]

export function EditorSettings() {
  const setPendingChange = useSettingsStore((s) => s.setPendingChange)

  const fontFamily = useSettingValue('editor.fontFamily')
  const fontSize = useSettingValue('editor.fontSize')
  const lineHeight = parseFloat(useSettingValue('editor.lineHeight')) || 1.6
  const wordWrap = useSettingValue('editor.wordWrap') === 'true'
  const minimap = useSettingValue('editor.minimap') === 'true'
  const lineNumbers = useSettingValue('editor.lineNumbers') === 'true'
  const autocompleteBackticks = useSettingValue('editor.autocompleteBackticks') === 'true'

  return (
    <div data-testid="settings-editor">
      <SettingsSection title="Font" description="Customize the query editor font.">
        <div>
          <label
            id="font-family-label"
            style={{ display: 'block', marginBottom: 6, fontSize: 'var(--type-size-sm)' }}
          >
            Font family
          </label>
          <Dropdown
            id="settings-font-family"
            labelledBy="font-family-label"
            options={FONT_FAMILY_OPTIONS}
            value={fontFamily}
            onChange={(value) => setPendingChange('editor.fontFamily', value)}
            data-testid="settings-font-family-dropdown"
          />
        </div>
        <div>
          <label
            htmlFor="settings-font-size"
            style={{ display: 'block', marginBottom: 6, fontSize: 'var(--type-size-sm)' }}
          >
            Font size (px)
          </label>
          <TextInput
            id="settings-font-size"
            type="number"
            min={8}
            max={32}
            value={fontSize}
            onChange={(e) => setPendingChange('editor.fontSize', e.target.value)}
            data-testid="settings-font-size"
            style={{ width: 120 }}
          />
        </div>
        <Slider
          label="Line height"
          min={1.0}
          max={2.5}
          step={0.1}
          value={lineHeight}
          onChange={(value) => setPendingChange('editor.lineHeight', String(value))}
        />
      </SettingsSection>

      <SettingsSection title="Editor Behavior" description="Toggle editor features.">
        <SettingsToggle
          label="Word wrap"
          description="Wrap long lines at the editor edge."
          checked={wordWrap}
          onChange={(checked) => setPendingChange('editor.wordWrap', String(checked))}
          data-testid="settings-word-wrap"
        />
        <SettingsToggle
          label="Minimap"
          description="Show a minimap overview on the right edge."
          checked={minimap}
          onChange={(checked) => setPendingChange('editor.minimap', String(checked))}
          data-testid="settings-minimap"
        />
        <SettingsToggle
          label="Line numbers"
          description="Show line numbers in the gutter."
          checked={lineNumbers}
          onChange={(checked) => setPendingChange('editor.lineNumbers', String(checked))}
          data-testid="settings-line-numbers"
        />
        <SettingsToggle
          label="Quote identifiers from autocomplete"
          description="Wrap schema suggestions (tables, columns, etc.) in MySQL backticks when inserting."
          checked={autocompleteBackticks}
          onChange={(checked) => setPendingChange('editor.autocompleteBackticks', String(checked))}
          data-testid="settings-autocomplete-backticks"
        />
      </SettingsSection>
    </div>
  )
}
