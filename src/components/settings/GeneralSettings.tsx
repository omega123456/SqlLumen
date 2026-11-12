import { TextInput } from '../common/TextInput'
import { SettingsSection } from './SettingsSection'
import { SettingsDropdownField, SettingsFieldLabel } from './SettingsField'
import { SettingsToggle } from './SettingsToggle'
import { useSettingsStore, useSettingValue } from '../../stores/settings-store'
import { useThemeStore } from '../../stores/theme-store'
import { useZoomStore, ZOOM_LEVELS, DEFAULT_ZOOM_LEVEL } from '../../stores/zoom-store'
import type { Theme } from '../../stores/theme-store'

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const ZOOM_OPTIONS = ZOOM_LEVELS.map((level) => ({
  value: String(level),
  label: level === DEFAULT_ZOOM_LEVEL ? `${DEFAULT_ZOOM_LEVEL}% (Default)` : `${level}%`,
}))

const SNAPSHOT_FREQUENCY_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'onClose', label: 'On close only' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
]

const SNAPSHOT_KEEP_OPTIONS = [
  { value: '5', label: '5' },
  { value: '10', label: '10' },
  { value: '20', label: '20' },
  { value: '50', label: '50' },
]

export function GeneralSettings() {
  const setPendingChange = useSettingsStore((state) => state.setPendingChange)
  const previewTheme = useThemeStore((state) => state.previewTheme)

  const theme = useSettingValue('theme')
  const zoom = useSettingValue('appearance.zoom')
  const sessionRestore = useSettingValue('session.restore') === 'true'
  const connectionTimeout = useSettingValue('connection.defaultTimeout')
  const keepalive = useSettingValue('connection.defaultKeepalive')
  const snapshotFrequency = useSettingValue('snapshots.frequency')
  const snapshotKeep = useSettingValue('snapshots.keep')

  const handleThemeChange = (value: string) => {
    setPendingChange('theme', value)
    previewTheme(value as Theme)
  }

  const handleZoomChange = (value: string) => {
    setPendingChange('appearance.zoom', value)
    useZoomStore.getState().previewZoom(Number(value))
  }

  return (
    <div data-testid="settings-general">
      <SettingsSection title="Appearance" description="Choose how the application looks.">
        <SettingsDropdownField
          name="theme"
          label="Theme"
          options={THEME_OPTIONS}
          value={theme}
          onChange={handleThemeChange}
        />
        <SettingsDropdownField
          name="zoom"
          label="Zoom"
          options={ZOOM_OPTIONS}
          value={zoom}
          onChange={handleZoomChange}
        />
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
        title="Session snapshots"
        description="Periodically capture your open connections and tabs so you can restore them later."
      >
        <SettingsDropdownField
          name="snapshot-frequency"
          label="Snapshot frequency"
          options={SNAPSHOT_FREQUENCY_OPTIONS}
          value={snapshotFrequency}
          onChange={(value) => setPendingChange('snapshots.frequency', value)}
        />
        <SettingsDropdownField
          name="snapshot-keep"
          label="Snapshots to keep"
          options={SNAPSHOT_KEEP_OPTIONS}
          value={snapshotKeep}
          onChange={(value) => setPendingChange('snapshots.keep', value)}
        />
      </SettingsSection>

      <SettingsSection
        title="Connection defaults"
        description="Default values for new connections."
      >
        <div>
          <SettingsFieldLabel htmlFor="settings-connection-timeout">
            Connection timeout (seconds)
          </SettingsFieldLabel>
          <TextInput
            id="settings-connection-timeout"
            type="number"
            min={1}
            max={120}
            value={connectionTimeout}
            onChange={(event) => setPendingChange('connection.defaultTimeout', event.target.value)}
            data-testid="settings-connection-timeout"
            style={{ width: 120 }}
          />
        </div>
        <div>
          <SettingsFieldLabel htmlFor="settings-keepalive">
            Keepalive interval (seconds)
          </SettingsFieldLabel>
          <TextInput
            id="settings-keepalive"
            type="number"
            min={0}
            max={3600}
            value={keepalive}
            onChange={(event) =>
              setPendingChange('connection.defaultKeepalive', event.target.value)
            }
            data-testid="settings-keepalive"
            style={{ width: 120 }}
          />
        </div>
      </SettingsSection>
    </div>
  )
}
