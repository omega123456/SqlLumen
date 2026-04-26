import { useEffect, useMemo, useState } from 'react'
import { ArrowsClockwise, CheckCircle, DownloadSimple, WarningCircle } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { Dropdown } from '../common/Dropdown'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { SettingsSection } from './SettingsSection'
import { getAppInfo } from '../../lib/app-info-commands'
import { logFrontend } from '../../lib/app-log-commands'
import { UPDATE_INTERVAL_OPTIONS } from '../../lib/update-intervals'
import { useConnectionStore } from '../../stores/connection-store'
import { useObjectEditorStore } from '../../stores/object-editor-store'
import { useQueryStore, hasAnyUnsavedEdits } from '../../stores/query-store'
import { useSettingsStore, useSettingValue } from '../../stores/settings-store'
import { useTableDataStore } from '../../stores/table-data-store'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import { useUpdateStore } from '../../stores/update-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import styles from './UpdatesSettings.module.css'

interface PendingWorkSummary {
  hasWork: boolean
  items: string[]
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function buildPendingWorkSummary(): PendingWorkSummary {
  const connectionState = useConnectionStore.getState()
  const queryState = useQueryStore.getState()
  const workspaceState = useWorkspaceStore.getState()
  const tableDataState = useTableDataStore.getState()
  const tableDesignerState = useTableDesignerStore.getState()
  const objectEditorState = useObjectEditorStore.getState()

  let runningQueries = 0
  let unsavedTabs = 0

  for (const tab of Object.values(queryState.tabs)) {
    if (tab.tabStatus === 'running') {
      runningQueries += 1
    }
    if (hasAnyUnsavedEdits(tab)) {
      unsavedTabs += 1
    }
  }

  for (const workspaceTabs of Object.values(workspaceState.tabsByConnection)) {
    for (const tab of workspaceTabs) {
      if (tab.type === 'table-data') {
        const editState = tableDataState.tabs[tab.id]?.editState
        if (editState && (editState.isNewRow || editState.modifiedColumns.size > 0)) {
          unsavedTabs += 1
        }
      } else if (tab.type === 'table-designer') {
        if (tableDesignerState.tabs[tab.id]?.isDirty) {
          unsavedTabs += 1
        }
      } else if (tab.type === 'object-editor' && objectEditorState.isDirty(tab.id)) {
        unsavedTabs += 1
      }
    }
  }

  const activeConnections = Object.keys(connectionState.activeConnections).length

  const items: string[] = []
  if (activeConnections > 0) items.push(pluralize(activeConnections, 'active database connection'))
  if (runningQueries > 0) items.push(pluralize(runningQueries, 'running query'))
  if (unsavedTabs > 0) items.push(pluralize(unsavedTabs, 'unsaved tab'))

  return {
    hasWork: items.length > 0,
    items,
  }
}

export function UpdatesSettings() {
  const setPendingChange = useSettingsStore((s) => s.setPendingChange)
  const status = useUpdateStore((s) => s.status)
  const availableVersion = useUpdateStore((s) => s.availableVersion)
  const downloadProgress = useUpdateStore((s) => s.downloadProgress)
  const errorMessage = useUpdateStore((s) => s.errorMessage)
  const checkForUpdate = useUpdateStore((s) => s.checkForUpdate)
  const downloadAndInstall = useUpdateStore((s) => s.downloadAndInstall)
  const checkInterval = useSettingValue('updates.checkInterval')

  const [appVersion, setAppVersion] = useState('Loading…')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isConfirmingDownload, setIsConfirmingDownload] = useState(false)

  useEffect(() => {
    let cancelled = false

    void getAppInfo()
      .then((info) => {
        if (!cancelled) {
          setAppVersion(info.appVersion)
        }
      })
      .catch((error: unknown) => {
        logFrontend('error', `[updates-settings] Failed to load app version: ${String(error)}`)
        if (!cancelled) {
          setAppVersion('Unavailable')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const pendingWork = useMemo(() => buildPendingWorkSummary(), [confirmOpen, status])

  const handleManualCheck = (): void => {
    void checkForUpdate(true)
  }

  const checkForUpdatesButton = (
    <Button variant="secondary" onClick={handleManualCheck} data-testid="updates-check-button">
      <ArrowsClockwise size={16} weight="regular" /> Check for Updates
    </Button>
  )

  const handleDownloadAndRestart = (): void => {
    const summary = buildPendingWorkSummary()
    if (summary.hasWork) {
      setConfirmOpen(true)
      return
    }

    void downloadAndInstall()
  }

  const handleConfirmDownload = (): void => {
    setIsConfirmingDownload(true)
    void downloadAndInstall().finally(() => {
      setIsConfirmingDownload(false)
      setConfirmOpen(false)
    })
  }

  const renderSoftwareUpdates = (): React.ReactNode => {
    switch (status) {
      case 'checking':
        return (
          <Button variant="secondary" disabled data-testid="updates-checking-button">
            <ArrowsClockwise size={16} weight="regular" className={styles.spinningIcon} />
            Checking…
          </Button>
        )
      case 'up-to-date':
        return (
          <div className={styles.statusRow} data-testid="updates-up-to-date">
            <span className={`${styles.statusMessage} ${styles.upToDate}`}>
              <CheckCircle size={16} weight="fill" />
              You're up to date (v{appVersion})
            </span>
            {checkForUpdatesButton}
          </div>
        )
      case 'available':
        return (
          <div
            className={`${styles.updateCard} ui-elevated-surface`}
            data-testid="updates-available-card"
          >
            <div className={styles.cardTitle}>Version {availableVersion ?? 'new'} is available</div>
            <div>
              <Button
                variant="primary"
                onClick={handleDownloadAndRestart}
                data-testid="updates-download-button"
              >
                <DownloadSimple size={16} weight="regular" /> Download & Restart
              </Button>
            </div>
          </div>
        )
      case 'installing':
        return (
          <div
            className={`${styles.updateCard} ui-elevated-surface`}
            data-testid="updates-installing-card"
          >
            <div className={styles.cardTitle}>
              Downloading version {availableVersion ?? 'update'}...
            </div>
            <div
              className={styles.progressTrack}
              data-testid="updates-progress-track"
              role="progressbar"
              aria-valuenow={downloadProgress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={styles.progressFill}
                data-testid="updates-progress-fill"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
            <div className={styles.progressMeta}>
              <span>Preparing restart</span>
              <span data-testid="updates-progress-text">{downloadProgress}%</span>
            </div>
          </div>
        )
      case 'error':
        return (
          <div className={styles.statusRow} data-testid="updates-error-state">
            <span className={`${styles.statusMessage} ${styles.errorMessage}`}>
              <WarningCircle size={16} weight="fill" />
              {errorMessage ?? 'Update check failed'}
            </span>
            <Button
              variant="secondary"
              onClick={handleManualCheck}
              data-testid="updates-try-again-button"
            >
              Try Again
            </Button>
          </div>
        )
      case 'idle':
      default:
        return checkForUpdatesButton
    }
  }

  return (
    <div data-testid="settings-updates">
      <SettingsSection title="App Version" description="Currently installed version of SqlLumen.">
        <div className={styles.versionValue} data-testid="updates-app-version">
          {appVersion}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Software Updates"
        description="Check if a newer version of SqlLumen is available."
      >
        {renderSoftwareUpdates()}
      </SettingsSection>

      <SettingsSection
        title="Automatic Updates"
        description="Control how often SqlLumen checks for updates."
      >
        <div>
          <label id="updates-check-interval-label" className={styles.fieldLabel}>
            Check frequency:
          </label>
          <Dropdown
            id="settings-updates-check-interval"
            labelledBy="updates-check-interval-label"
            options={UPDATE_INTERVAL_OPTIONS.map(({ label, value }) => ({ label, value }))}
            value={checkInterval}
            onChange={(value) => setPendingChange('updates.checkInterval', value)}
            data-testid="settings-updates-check-interval"
          />
        </div>
      </SettingsSection>

      <ConfirmDialog
        isOpen={confirmOpen}
        title="Download & Restart?"
        message={
          <div>
            Downloading the update will restart SqlLumen and interrupt:
            <ul className={styles.confirmList}>
              {pendingWork.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        }
        confirmLabel="Download & Restart"
        isDestructive
        warningText={null}
        isLoading={isConfirmingDownload}
        onConfirm={handleConfirmDownload}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
