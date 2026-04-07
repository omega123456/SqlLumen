import { Dropdown } from '../common/Dropdown'
import { TextInput } from '../common/TextInput'
import { SettingsSection } from './SettingsSection'
import { SettingsToggle } from './SettingsToggle'
import { useSettingsStore, useSettingValue } from '../../stores/settings-store'
import { useThemeStore } from '../../stores/theme-store'
import type { Theme } from '../../stores/theme-store'

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function GeneralSettings() {
  const setPendingChange = useSettingsStore((s) => s.setPendingChange)
  const previewTheme = useThemeStore((s) => s.previewTheme)

  const theme = useSettingValue('theme')
  const sessionRestore = useSettingValue('session.restore') === 'true'
  const connectionTimeout = useSettingValue('connection.defaultTimeout')
  const keepalive = useSettingValue('connection.defaultKeepalive')

  const handleThemeChange = (value: string) => {
    setPendingChange('theme', value)
    previewTheme(value as Theme)
  }

  return (
    <div data-testid="settings-general">
      <SettingsSection title="Appearance" description="Choose how the application looks.">
        <div>
          <label
            id="theme-label"
            style={{ display: 'block', marginBottom: 6, fontSize: 'var(--type-size-sm)' }}
          >
            Theme
          </label>
          <Dropdown
            id="settings-theme"
            labelledBy="theme-label"
            options={THEME_OPTIONS}
            value={theme}
            onChange={handleThemeChange}
            data-testid="settings-theme-dropdown"
          />
        </div>
      </SettingsSection>

      <SettingsSection title="Session" description="Control session behavior on launch.">
        <SettingsToggle
          label="Restore previous session"
          description="Reopen connections and tabs from the last session on startup."
          checked={sessionRestore}
          onChange={(checked) => setPendingChange('session.restore', String(checked))}
          data-testid="settings-session-restore"
        />
      </SettingsSection>

      <SettingsSection
        title="Connection Defaults"
        description="Default values for new connections."
      >
        <div>
          <label
            htmlFor="settings-connection-timeout"
            style={{ display: 'block', marginBottom: 6, fontSize: 'var(--type-size-sm)' }}
          >
            Connection timeout (seconds)
          </label>
          <TextInput
            id="settings-connection-timeout"
            type="number"
            min={1}
            max={120}
            value={connectionTimeout}
            onChange={(e) => setPendingChange('connection.defaultTimeout', e.target.value)}
            data-testid="settings-connection-timeout"
            style={{ width: 120 }}
          />
        </div>
        <div>
          <label
            htmlFor="settings-keepalive"
            style={{ display: 'block', marginBottom: 6, fontSize: 'var(--type-size-sm)' }}
          >
            Keepalive interval (seconds)
          </label>
          <TextInput
            id="settings-keepalive"
            type="number"
            min={0}
            max={3600}
            value={keepalive}
            onChange={(e) => setPendingChange('connection.defaultKeepalive', e.target.value)}
            data-testid="settings-keepalive"
            style={{ width: 120 }}
          />
        </div>
      </SettingsSection>
    </div>
  )
}
