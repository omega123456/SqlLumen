import { useEffect, useState } from 'react'
import { SettingsSection } from './SettingsSection'
import { SettingsDropdownField } from './SettingsField'
import { LogViewer } from './LogViewer'
import { useSettingsStore, useSettingValue } from '../../stores/settings-store'
import { getAppInfo } from '../../lib/app-info-commands'
import type { AppInfo } from '../../types/schema'

import { logFrontendError } from '../../lib/app-log-commands'
const LOG_LEVEL_OPTIONS = [
  { value: 'error', label: 'Error' },
  { value: 'warn', label: 'Warn' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
  { value: 'trace', label: 'Trace' },
]

export function LoggingSettings() {
  const setPendingChange = useSettingsStore((state) => state.setPendingChange)

  const logLevel = useSettingValue('log.level')

  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    getAppInfo()
      .then((info) => {
        if (!cancelled) setAppInfo(info)
      })
      .catch((error) => {
        logFrontendError('[settings] Failed to load app info:', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div data-testid="settings-logging">
      <SettingsSection title="Application" description="Application version and diagnostics.">
        <div className="text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
          <strong>Version:</strong> {appInfo?.appVersion ?? '...'}
        </div>
      </SettingsSection>

      <SettingsSection title="Log level" description="Set the minimum log level for the backend.">
        <SettingsDropdownField
          name="log-level"
          label={
            <>
              Log level
              {appInfo?.rustLogOverride && (
                <span
                  className="ml-2 text-size-caption text-light-warning dark:text-dark-warning"
                  data-testid="settings-rust-log-override"
                >
                  (overridden by RUST_LOG)
                </span>
              )}
            </>
          }
          options={LOG_LEVEL_OPTIONS}
          value={logLevel}
          onChange={(value) => setPendingChange('log.level', value)}
          disabled={appInfo?.rustLogOverride ?? false}
        />
      </SettingsSection>

      <LogViewer />
    </div>
  )
}
