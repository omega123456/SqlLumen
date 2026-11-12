import { useEffect, useEffectEvent, useState } from 'react'
import { ArrowsClockwise, CheckCircle, DownloadSimple, WarningCircle } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { Dropdown } from '../common/Dropdown'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { SettingsSection } from './SettingsSection'
import { getAppInfo } from '../../lib/app-info-commands'
import { UPDATE_INTERVAL_OPTIONS } from '../../lib/update-intervals'
import { useConnectionStore } from '../../stores/connection-store'
import { useObjectEditorStore } from '../../stores/object-editor-store'
import { useQueryStore, hasAnyUnsavedEdits } from '../../stores/query-store'
import { useSettingsStore, useSettingValue } from '../../stores/settings-store'
import { useTableDataStore } from '../../stores/table-data-store'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import {
  useUpdateStore,
  type ReadyToFinishAction,
  type UpdateStatus,
} from '../../stores/update-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import styles from './UpdatesSettings.module.css'

import { logFrontend } from '../../lib/app-log-commands'
import { hasPendingRowChanges } from '../../lib/row-edit-state'
interface PendingWorkSummary {
  hasWork: boolean
  items: string[]
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

type WorkspaceTabType = ReturnType<
  typeof useWorkspaceStore.getState
>['tabsByConnection'][string][number]['type']

const UNSAVED_TAB_CHECKS: Partial<Record<WorkspaceTabType, (tabId: string) => boolean>> = {
  'table-data': (tabId) =>
    hasPendingRowChanges(useTableDataStore.getState().tabs[tabId]?.editState),
  'table-designer': (tabId) => useTableDesignerStore.getState().tabs[tabId]?.isDirty === true,
  'object-editor': (tabId) => useObjectEditorStore.getState().isDirty(tabId),
}

function countQueryTabWork() {
  const queryTabs = Object.values(useQueryStore.getState().tabs)
  return {
    runningQueries: queryTabs.filter((tab) => tab.tabStatus === 'running').length,
    unsavedTabs: queryTabs.filter(hasAnyUnsavedEdits).length,
  }
}

function countUnsavedWorkspaceTabs(): number {
  const workspaceTabs = Object.values(useWorkspaceStore.getState().tabsByConnection).flat()
  return workspaceTabs.filter((tab) => UNSAVED_TAB_CHECKS[tab.type]?.(tab.id) === true).length
}

function buildPendingWorkSummary(): PendingWorkSummary {
  const queryWork = countQueryTabWork()
  const unsavedTabs = queryWork.unsavedTabs + countUnsavedWorkspaceTabs()
  const activeConnections = Object.keys(useConnectionStore.getState().activeConnections).length

  const items: string[] = []
  if (activeConnections > 0) items.push(pluralize(activeConnections, 'active database connection'))
  if (queryWork.runningQueries > 0) items.push(pluralize(queryWork.runningQueries, 'running query'))
  if (unsavedTabs > 0) items.push(pluralize(unsavedTabs, 'unsaved tab'))

  return {
    hasWork: items.length > 0,
    items: items,
  }
}

type ConfirmAction = 'download' | 'restart'

const CONFIRM_ACTION_COPY: Record<
  ConfirmAction,
  { title: string; intro: string; confirmLabel: string }
> = {
  download: {
    title: 'Download update?',
    intro: 'Downloading the update may interrupt:',
    confirmLabel: 'Download update',
  },
  restart: {
    title: 'Restart app?',
    intro: 'Restarting SqlLumen will interrupt:',
    confirmLabel: 'Restart app',
  },
}

interface SoftwareUpdateViewProps {
  appVersion: string
  availableVersion: string | null
  downloadProgress: number
  errorMessage: string | null
  readyToFinish: { action: ReadyToFinishAction; cta: string; message: string }
  checkForUpdatesButton: React.ReactNode
  handlers: {
    onManualCheck: () => void
    onDownloadUpdate: () => void
    onRestartAction: () => void
    onLater: () => void
  }
}

function UpToDateView({ appVersion, checkForUpdatesButton }: SoftwareUpdateViewProps) {
  return (
    <div className={styles.statusRow} data-testid="updates-up-to-date">
      <span className={`${styles.statusMessage} ${styles.upToDate}`}>
        <CheckCircle size={16} weight="fill" />
        You're up to date (v{appVersion})
      </span>
      {checkForUpdatesButton}
    </div>
  )
}

function UpdateAvailableView({ availableVersion, handlers }: SoftwareUpdateViewProps) {
  return (
    <div
      className={`${styles.updateCard} ui-elevated-surface`}
      data-testid="updates-available-card"
    >
      <div className={styles.cardTitle}>Version {availableVersion ?? 'new'} is available</div>
      <div>
        <Button
          variant="accent"
          onClick={handlers.onDownloadUpdate}
          data-testid="updates-download-button"
        >
          <DownloadSimple size={16} weight="regular" /> Download update
        </Button>
      </div>
    </div>
  )
}

function InstallingView({ availableVersion, downloadProgress }: SoftwareUpdateViewProps) {
  return (
    <div
      className={`${styles.updateCard} ui-elevated-surface`}
      data-testid="updates-installing-card"
    >
      <div className={styles.cardTitle}>Downloading version {availableVersion ?? 'update'}...</div>
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
        <span>Downloading update</span>
        <span data-testid="updates-progress-text">{downloadProgress}%</span>
      </div>
    </div>
  )
}

function ReadyToFinishView({ readyToFinish, errorMessage, handlers }: SoftwareUpdateViewProps) {
  const isManualQuit = readyToFinish.action === 'manual-quit'
  return (
    <div
      className={`${styles.updateCard} ui-elevated-surface`}
      data-testid="updates-ready-card"
      aria-live="polite"
    >
      <div className={styles.cardTitle}>
        {isManualQuit ? 'Restart required' : 'Update downloaded'}
      </div>
      <div className={styles.cardBody} data-testid="updates-ready-message">
        {readyToFinish.message}
      </div>
      {errorMessage ? (
        <div
          className={`${styles.statusMessage} ${styles.errorMessage}`}
          data-testid="updates-ready-error"
        >
          <WarningCircle size={16} weight="fill" /> Restart failed: {errorMessage}
        </div>
      ) : null}
      <div className={styles.cardActions}>
        <Button
          variant="accent"
          onClick={handlers.onRestartAction}
          data-testid="updates-restart-button"
        >
          {isManualQuit ? (
            <CheckCircle size={16} weight="regular" />
          ) : (
            <ArrowsClockwise size={16} weight="regular" />
          )}
          {readyToFinish.cta}
        </Button>
        <Button onClick={handlers.onLater} data-testid="updates-later-button">
          Later
        </Button>
      </div>
    </div>
  )
}

function UpdateErrorView({ errorMessage, handlers }: SoftwareUpdateViewProps) {
  return (
    <div className={styles.statusRow} data-testid="updates-error-state">
      <span className={`${styles.statusMessage} ${styles.errorMessage}`}>
        <WarningCircle size={16} weight="fill" />
        {errorMessage ?? 'Update check failed'}
      </span>
      <Button onClick={handlers.onManualCheck} data-testid="updates-try-again-button">
        Try again
      </Button>
    </div>
  )
}

function CheckingView() {
  return (
    <Button disabled data-testid="updates-checking-button">
      <ArrowsClockwise size={16} weight="regular" className={styles.spinningIcon} />
      Checking…
    </Button>
  )
}

function IdleView({ checkForUpdatesButton }: SoftwareUpdateViewProps) {
  return <>{checkForUpdatesButton}</>
}

const SOFTWARE_UPDATE_VIEWS: Record<
  UpdateStatus,
  (props: SoftwareUpdateViewProps) => React.ReactNode
> = {
  checking: CheckingView,
  'up-to-date': UpToDateView,
  available: UpdateAvailableView,
  installing: InstallingView,
  'ready-to-finish': ReadyToFinishView,
  error: UpdateErrorView,
  idle: IdleView,
}

export function UpdatesSettings() {
  const setPendingChange = useSettingsStore((state) => state.setPendingChange)
  const closeSettingsDialog = useSettingsStore((state) => state.closeDialog)
  const status = useUpdateStore((state) => state.status)
  const availableVersion = useUpdateStore((state) => state.availableVersion)
  const downloadProgress = useUpdateStore((state) => state.downloadProgress)
  const errorMessage = useUpdateStore((state) => state.errorMessage)
  const checkForUpdate = useUpdateStore((state) => state.checkForUpdate)
  const downloadAndInstall = useUpdateStore((state) => state.downloadAndInstall)
  const restartApp = useUpdateStore((state) => state.restartApp)
  const readyToFinishAction = useUpdateStore((state) => state.readyToFinishAction)
  const readyToFinishCta = useUpdateStore((state) => state.readyToFinishCta)
  const readyToFinishMessage = useUpdateStore((state) => state.readyToFinishMessage)
  const checkInterval = useSettingValue('updates.checkInterval')

  const [appVersion, setAppVersion] = useState('Loading…')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>('download')
  const [isConfirmingAction, setIsConfirmingAction] = useState(false)

  const recheckAnnouncedUpdate = useEffectEvent(() => {
    if (status === 'available') {
      void checkForUpdate(false)
    }
  })

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

    recheckAnnouncedUpdate()

    return () => {
      cancelled = true
    }
  }, [])

  const pendingWork = buildPendingWorkSummary()

  const handleManualCheck = (): void => {
    void checkForUpdate(true)
  }

  const checkForUpdatesButton = (
    <Button onClick={handleManualCheck} data-testid="updates-check-button">
      <ArrowsClockwise size={16} weight="regular" /> Check for Updates
    </Button>
  )

  const handleDownloadUpdate = (): void => {
    const summary = buildPendingWorkSummary()
    if (summary.hasWork) {
      setConfirmAction('download')
      setConfirmOpen(true)
      return
    }

    void downloadAndInstall()
  }

  const handleRestartAction = (): void => {
    if (readyToFinishAction === 'manual-quit') {
      closeSettingsDialog()
      return
    }

    const summary = buildPendingWorkSummary()
    if (summary.hasWork) {
      setConfirmAction('restart')
      setConfirmOpen(true)
      return
    }

    void restartApp()
  }

  const handleConfirmAction = (): void => {
    setIsConfirmingAction(true)

    const action = confirmAction === 'download' ? downloadAndInstall : restartApp
    void action().finally(() => {
      setIsConfirmingAction(false)
      setConfirmOpen(false)
    })
  }

  const SoftwareUpdateView = SOFTWARE_UPDATE_VIEWS[status]
  const confirmCopy = CONFIRM_ACTION_COPY[confirmAction]

  return (
    <div data-testid="settings-updates">
      <SettingsSection title="App version" description="Currently installed version of SqlLumen.">
        <div className={styles.versionValue} data-testid="updates-app-version">
          {appVersion}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Software updates"
        description="Check if a newer version of SqlLumen is available."
      >
        <SoftwareUpdateView
          appVersion={appVersion}
          availableVersion={availableVersion}
          downloadProgress={downloadProgress}
          errorMessage={errorMessage}
          readyToFinish={{
            action: readyToFinishAction,
            cta: readyToFinishCta,
            message: readyToFinishMessage,
          }}
          checkForUpdatesButton={checkForUpdatesButton}
          handlers={{
            onManualCheck: handleManualCheck,
            onDownloadUpdate: handleDownloadUpdate,
            onRestartAction: handleRestartAction,
            onLater: closeSettingsDialog,
          }}
        />
      </SettingsSection>

      <SettingsSection
        title="Automatic updates"
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
        title={confirmCopy.title}
        message={
          <div>
            {confirmCopy.intro}
            <ul className={styles.confirmList}>
              {pendingWork.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        }
        confirmLabel={confirmCopy.confirmLabel}
        isDestructive
        warningText={null}
        isLoading={isConfirmingAction}
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
