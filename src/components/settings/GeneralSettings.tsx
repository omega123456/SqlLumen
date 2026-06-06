import { Dropdown } from '../common/Dropdown'
import { TextInput } from '../common/TextInput'
import { SettingsSection } from './SettingsSection'
import { SettingsToggle } from './SettingsToggle'
import { useSettingsStore, useSettingValue } from '../../stores/settings-store'
import { useThemeStore } from '../../stores/theme-store'
import { useZoomStore, ZOOM_LEVELS } from '../../stores/zoom-store'
import type { Theme } from '../../stores/theme-store'

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const ZOOM_OPTIONS = ZOOM_LEVELS.map((level) => ({
  value: String(level),
  label: level === 100 ? '100% (Default)' : `${level}%`,
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
  const setPendingChange = useSettingsStore((s) => s.setPendingChange)
  const previewTheme = useThemeStore((s) => s.previewTheme)

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
        <div>
          <label
            id="zoom-label"
            style={{ display: 'block', marginBottom: 6, fontSize: 'var(--type-size-sm)' }}
          >
            Zoom
          </label>
          <Dropdown
            id="settings-zoom"
            labelledBy="zoom-label"
            options={ZOOM_OPTIONS}
            value={zoom}
            onChange={handleZoomChange}
            data-testid="settings-zoom-dropdown"
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
        title="Session Snapshots"
        description="Periodically capture your open connections and tabs so you can restore them later."
      >
        <div>
          <label
            id="snapshot-frequency-label"
            style={{ display: 'block', marginBottom: 6, fontSize: 'var(--type-size-sm)' }}
          >
            Snapshot frequency
          </label>
          <Dropdown
            id="settings-snapshot-frequency"
            labelledBy="snapshot-frequency-label"
            options={SNAPSHOT_FREQUENCY_OPTIONS}
            value={snapshotFrequency}
            onChange={(value) => setPendingChange('snapshots.frequency', value)}
            data-testid="settings-snapshot-frequency-dropdown"
          />
        </div>
        <div>
          <label
            id="snapshot-keep-label"
            style={{ display: 'block', marginBottom: 6, fontSize: 'var(--type-size-sm)' }}
          >
            Snapshots to keep
          </label>
          <Dropdown
            id="settings-snapshot-keep"
            labelledBy="snapshot-keep-label"
            options={SNAPSHOT_KEEP_OPTIONS}
            value={snapshotKeep}
            onChange={(value) => setPendingChange('snapshots.keep', value)}
            data-testid="settings-snapshot-keep-dropdown"
          />
        </div>
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
