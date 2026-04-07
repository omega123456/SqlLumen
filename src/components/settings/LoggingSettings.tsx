import { useEffect, useState } from 'react'
import { Dropdown } from '../common/Dropdown'
import { SettingsSection } from './SettingsSection'
import { useSettingsStore, useSettingValue } from '../../stores/settings-store'
import { getAppInfo } from '../../lib/app-info-commands'
import type { AppInfo } from '../../types/schema'

const LOG_LEVEL_OPTIONS = [
  { value: 'error', label: 'Error' },
  { value: 'warn', label: 'Warn' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
  { value: 'trace', label: 'Trace' },
]

export function LoggingSettings() {
  const setPendingChange = useSettingsStore((s) => s.setPendingChange)

  const logLevel = useSettingValue('log.level')

  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    getAppInfo()
      .then((info) => {
        if (!cancelled) setAppInfo(info)
      })
      .catch((err) => {
        console.error('[settings] Failed to load app info:', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div data-testid="settings-logging">
      <SettingsSection title="Application" description="Application version and diagnostics.">
        <div style={{ fontSize: 'var(--type-size-sm)', color: 'var(--on-surface-variant)' }}>
          <strong>Version:</strong> {appInfo?.appVersion ?? '...'}
        </div>
        <div style={{ fontSize: 'var(--type-size-sm)', color: 'var(--on-surface-variant)' }}>
          <strong>Log directory:</strong>{' '}
          <code data-testid="settings-log-dir">{appInfo?.logDirectory ?? '...'}</code>
        </div>
      </SettingsSection>

      <SettingsSection title="Log Level" description="Set the minimum log level for the backend.">
        <div>
          <label
            id="log-level-label"
            style={{ display: 'block', marginBottom: 6, fontSize: 'var(--type-size-sm)' }}
          >
            Log level
            {appInfo?.rustLogOverride && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 'var(--type-size-xs)',
                  color: 'var(--warning)',
                }}
                data-testid="settings-rust-log-override"
              >
                (overridden by RUST_LOG)
              </span>
            )}
          </label>
          <Dropdown
            id="settings-log-level"
            labelledBy="log-level-label"
            options={LOG_LEVEL_OPTIONS}
            value={logLevel}
            onChange={(value) => setPendingChange('log.level', value)}
            disabled={appInfo?.rustLogOverride ?? false}
            data-testid="settings-log-level-dropdown"
          />
        </div>
      </SettingsSection>
    </div>
  )
}
