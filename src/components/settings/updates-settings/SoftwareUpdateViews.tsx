import type { ReactNode } from 'react'
import { ArrowsClockwise, CheckCircle, DownloadSimple, WarningCircle } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import type { ReadyToFinishAction, UpdateStatus } from '../../../stores/update-store'
import styles from '../UpdatesSettings.module.css'

const PERCENT_MAX = 100

export interface SoftwareUpdateViewProps {
  appVersion: string
  availableVersion: string | null
  downloadProgress: number
  errorMessage: string | null
  readyToFinish: { action: ReadyToFinishAction; cta: string; message: string }
  checkForUpdatesButton: ReactNode
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
        aria-valuemax={PERCENT_MAX}
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

const SOFTWARE_UPDATE_VIEWS: Record<UpdateStatus, (props: SoftwareUpdateViewProps) => ReactNode> = {
  checking: CheckingView,
  'up-to-date': UpToDateView,
  available: UpdateAvailableView,
  installing: InstallingView,
  'ready-to-finish': ReadyToFinishView,
  error: UpdateErrorView,
  idle: IdleView,
}

export function SoftwareUpdateView(props: SoftwareUpdateViewProps & { status: UpdateStatus }) {
  const ViewForStatus = SOFTWARE_UPDATE_VIEWS[props.status]
  return <ViewForStatus {...props} />
}
