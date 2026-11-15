import { ArrowsClockwise } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { Dropdown } from '../common/Dropdown'
import { SettingsSection } from './SettingsSection'
import { UPDATE_INTERVAL_OPTIONS } from '../../lib/update-intervals'
import { useSettingsStore, useSettingValue } from '../../stores/settings-store'
import { useUpdateStore } from '../../stores/update-store'
import { SETTINGS_MUTED_FIELD_LABEL } from '../../lib/class-names-settings'
import { SoftwareUpdateView } from './updates-settings/SoftwareUpdateViews'
import { UpdateConfirmDialog } from './updates-settings/UpdateConfirmDialog'
import { useAppVersion } from './updates-settings/use-app-version'
import { useUpdateActions, type UpdateActions } from './updates-settings/use-update-actions'

const INTERVAL_DROPDOWN_OPTIONS = UPDATE_INTERVAL_OPTIONS.map(({ label, value }) => ({
  label,
  value,
}))

function AutomaticUpdatesSection() {
  const setPendingChange = useSettingsStore((state) => state.setPendingChange)
  const checkInterval = useSettingValue('updates.checkInterval')
  return (
    <SettingsSection
      title="Automatic updates"
      description="Control how often SqlLumen checks for updates."
    >
      <div>
        <label id="updates-check-interval-label" className={SETTINGS_MUTED_FIELD_LABEL}>
          Check frequency:
        </label>
        <Dropdown
          id="settings-updates-check-interval"
          labelledBy="updates-check-interval-label"
          options={INTERVAL_DROPDOWN_OPTIONS}
          value={checkInterval}
          onChange={(value) => setPendingChange('updates.checkInterval', value)}
          data-testid="settings-updates-check-interval"
        />
      </div>
    </SettingsSection>
  )
}

function SoftwareUpdatesSection({
  appVersion,
  actions,
}: {
  appVersion: string
  actions: UpdateActions
}) {
  const status = useUpdateStore((state) => state.status)
  const availableVersion = useUpdateStore((state) => state.availableVersion)
  const downloadProgress = useUpdateStore((state) => state.downloadProgress)
  const errorMessage = useUpdateStore((state) => state.errorMessage)
  const readyToFinishAction = useUpdateStore((state) => state.readyToFinishAction)
  const readyToFinishCta = useUpdateStore((state) => state.readyToFinishCta)
  const readyToFinishMessage = useUpdateStore((state) => state.readyToFinishMessage)
  return (
    <SettingsSection
      title="Software updates"
      description="Check if a newer version of SqlLumen is available."
    >
      <SoftwareUpdateView
        status={status}
        appVersion={appVersion}
        availableVersion={availableVersion}
        downloadProgress={downloadProgress}
        errorMessage={errorMessage}
        readyToFinish={{
          action: readyToFinishAction,
          cta: readyToFinishCta,
          message: readyToFinishMessage,
        }}
        checkForUpdatesButton={
          <Button onClick={actions.handleManualCheck} data-testid="updates-check-button">
            <ArrowsClockwise size={16} weight="regular" /> Check for Updates
          </Button>
        }
        handlers={{
          onManualCheck: actions.handleManualCheck,
          onDownloadUpdate: actions.handleDownloadUpdate,
          onRestartAction: actions.handleRestartAction,
          onLater: actions.closeSettingsDialog,
        }}
      />
    </SettingsSection>
  )
}

export function UpdatesSettings() {
  const appVersion = useAppVersion()
  const actions = useUpdateActions()
  return (
    <div data-testid="settings-updates">
      <SettingsSection title="App version" description="Currently installed version of SqlLumen.">
        <div
          className="font-mono text-size-caption text-light-on-surface dark:text-dark-on-surface"
          data-testid="updates-app-version"
        >
          {appVersion}
        </div>
      </SettingsSection>
      <SoftwareUpdatesSection appVersion={appVersion} actions={actions} />
      <AutomaticUpdatesSection />
      <UpdateConfirmDialog actions={actions} />
    </div>
  )
}
