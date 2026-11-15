import type { ReactNode } from 'react'
import { ArrowsClockwise, CheckCircle, DownloadSimple, WarningCircle } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { ELEVATED_SURFACE, joinClassNames } from '../../../lib/class-names'
import type { ReadyToFinishAction, UpdateStatus } from '../../../stores/update-store'

const PERCENT_MAX = 100

type StatusTone = 'neutral' | 'success' | 'error'

const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'text-light-on-surface-variant dark:text-dark-on-surface-variant',
  success: 'text-light-tertiary dark:text-dark-tertiary',
  error: 'text-light-error dark:text-dark-error',
}

function StatusMessage({
  tone,
  testId,
  children,
}: {
  tone: StatusTone
  testId?: string
  children: ReactNode
}) {
  return (
    <span
      className={joinClassNames([
        'inline-flex items-center gap-1 text-size-caption',
        STATUS_TONE_CLASSES[tone],
      ])}
      data-testid={testId}
    >
      {children}
    </span>
  )
}

function StatusRow({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={testId}>
      {children}
    </div>
  )
}

function UpdateCard({
  testId,
  live,
  children,
}: {
  testId: string
  live?: 'polite'
  children: ReactNode
}) {
  return (
    <div
      className={joinClassNames(['flex flex-col gap-2 p-3', ELEVATED_SURFACE])}
      data-testid={testId}
      aria-live={live}
    >
      {children}
    </div>
  )
}

function CardTitle({ children }: { children: ReactNode }) {
  return (
    <div className="text-size-row text-light-on-surface dark:text-dark-on-surface">{children}</div>
  )
}

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
    <StatusRow testId="updates-up-to-date">
      <StatusMessage tone="success">
        <CheckCircle size={16} weight="fill" />
        You're up to date (v{appVersion})
      </StatusMessage>
      {checkForUpdatesButton}
    </StatusRow>
  )
}

function UpdateAvailableView({ availableVersion, handlers }: SoftwareUpdateViewProps) {
  return (
    <UpdateCard testId="updates-available-card">
      <CardTitle>Version {availableVersion ?? 'new'} is available</CardTitle>
      <div>
        <Button
          variant="accent"
          onClick={handlers.onDownloadUpdate}
          data-testid="updates-download-button"
        >
          <DownloadSimple size={16} weight="regular" /> Download update
        </Button>
      </div>
    </UpdateCard>
  )
}

function InstallingView({ availableVersion, downloadProgress }: SoftwareUpdateViewProps) {
  return (
    <UpdateCard testId="updates-installing-card">
      <CardTitle>Downloading version {availableVersion ?? 'update'}...</CardTitle>
      <div
        className="h-1 w-full overflow-hidden rounded-pill bg-light-surface-container-highest dark:bg-dark-surface-container-highest"
        data-testid="updates-progress-track"
        role="progressbar"
        aria-valuenow={downloadProgress}
        aria-valuemin={0}
        aria-valuemax={PERCENT_MAX}
      >
        <div
          className="h-full rounded-pill bg-light-primary transition-width duration-160 dark:bg-dark-primary"
          data-testid="updates-progress-fill"
          style={{ width: `${downloadProgress}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
        <span>Downloading update</span>
        <span data-testid="updates-progress-text">{downloadProgress}%</span>
      </div>
    </UpdateCard>
  )
}

function ReadyToFinishView({ readyToFinish, errorMessage, handlers }: SoftwareUpdateViewProps) {
  const isManualQuit = readyToFinish.action === 'manual-quit'
  return (
    <UpdateCard testId="updates-ready-card" live="polite">
      <CardTitle>{isManualQuit ? 'Restart required' : 'Update downloaded'}</CardTitle>
      <div
        className="text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant"
        data-testid="updates-ready-message"
      >
        {readyToFinish.message}
      </div>
      {errorMessage ? (
        <StatusMessage tone="error" testId="updates-ready-error">
          <WarningCircle size={16} weight="fill" /> Restart failed: {errorMessage}
        </StatusMessage>
      ) : null}
      <div className="flex flex-wrap gap-2">
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
    </UpdateCard>
  )
}

function UpdateErrorView({ errorMessage, handlers }: SoftwareUpdateViewProps) {
  return (
    <StatusRow testId="updates-error-state">
      <StatusMessage tone="error">
        <WarningCircle size={16} weight="fill" />
        {errorMessage ?? 'Update check failed'}
      </StatusMessage>
      <Button onClick={handlers.onManualCheck} data-testid="updates-try-again-button">
        Try again
      </Button>
    </StatusRow>
  )
}

function CheckingView() {
  return (
    <Button disabled data-testid="updates-checking-button">
      <ArrowsClockwise
        size={16}
        weight="regular"
        className="animate-spin-1000ms window-blurred:animate-spin-1000ms-paused"
      />
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
