import type { ReactNode } from 'react'
import { Database, ArrowsClockwise, WarningCircle } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { joinClassNames } from '../../../lib/class-names'
import { FOCUS_RING } from '../../../lib/focus-ring'
import {
  STATUS_BAR,
  STATUS_BAR_ACTIVITY,
  STATUS_BAR_LEFT,
  STATUS_BAR_RIGHT,
  STATUS_BAR_SPACER,
  STATUS_TEXT,
} from '../../../lib/class-names-status-bar'
import type { SingleResultState } from '../../../stores/query-store'
import type { ConnectionIndexState } from '../../../stores/schema-index-store'
import {
  INDEX_FLASH_DISPLAY,
  PREPARING_PHASE,
  rowCountText,
  type FlashType,
  type IndexingProgress,
  type RowCountParts,
  type TableDataInfoState,
} from './status-bar-model'
import type { PendingWork } from './pending-work-model'

const INDEXING_INDICATOR = 'flex shrink-0 items-center gap-1 transition-fade-slide duration-500'
const INDEXING_ICON = 'size-3 shrink-0'
const QUERY_INFO = 'flex shrink-0 items-center gap-5'
const QUERY_INFO_LABEL = 'text-light-on-surface-variant dark:text-dark-on-surface-variant'
const QUERY_INFO_VALUE = 'font-semibold text-light-on-surface dark:text-dark-on-surface'

function flashFadeClassName(fadingOut: boolean): string {
  if (fadingOut) return 'opacity-0 -translate-x-1'
  return ''
}

export function IndexBuildingIndicator({
  indexState,
  progress,
}: {
  indexState: ConnectionIndexState
  progress: IndexingProgress
}) {
  const phase = progress.phase ?? PREPARING_PHASE
  const accessibilityProps = progress.isCountBased
    ? {
        role: 'progressbar',
        'aria-valuenow': indexState.tablesDone,
        'aria-valuemin': 0,
        'aria-valuemax': indexState.tablesTotal,
        'aria-valuetext': `Schema indexing progress: ${indexState.tablesDone} of ${indexState.tablesTotal}`,
      }
    : { role: 'status', 'aria-label': progress.label }
  return (
    <div
      className={INDEXING_INDICATOR}
      data-testid="indexing-indicator"
      data-phase={phase}
      {...accessibilityProps}
    >
      <Database
        size={12}
        className="size-3 shrink-0 motion-safe:animate-pulse-dim motion-safe:window-blurred:animate-pulse-dim-paused"
      />
      <span className={STATUS_TEXT} data-testid="indexing-text">
        {progress.label}
      </span>
    </div>
  )
}

export function IndexFlashIndicator({
  flashType,
  fadingOut,
}: {
  flashType: FlashType
  fadingOut: boolean
}) {
  const display = INDEX_FLASH_DISPLAY[flashType]
  const Icon = display.icon
  return (
    <div
      className={joinClassNames([INDEXING_INDICATOR, flashFadeClassName(fadingOut)])}
      data-testid={display.testId}
    >
      <Icon
        size={12}
        weight="fill"
        className={joinClassNames([INDEXING_ICON, display.toneClassName])}
      />
      <span
        className={joinClassNames(['whitespace-nowrap text-size-caption', display.toneClassName])}
      >
        {display.text}
      </span>
    </div>
  )
}

function StatusSpinner() {
  return (
    <span
      className="inline-block size-2.5 animate-spin-700ms rounded-round border-spinner border-light-primary-a30 border-t-light-primary window-blurred:animate-spin-700ms-paused dark:border-dark-primary-a30 dark:border-t-dark-primary"
      aria-hidden="true"
    />
  )
}

export function QueryRunningInfo() {
  return (
    <div className="flex shrink-0 items-center gap-1" data-testid="query-running-info">
      <StatusSpinner />
      <span className={STATUS_TEXT}>Running...</span>
    </div>
  )
}

interface PendingWorkInfoProps {
  work: PendingWork
  onCancel: () => void
}

export function PendingWorkInfo({ work, onCancel }: PendingWorkInfoProps) {
  return (
    <div className="flex shrink-0 items-center gap-1" data-testid="status-pending-work">
      <StatusSpinner />
      <span className={STATUS_TEXT} data-testid="status-pending-work-label">
        {work.label}
      </span>
      {work.isCancellable && (
        <Button
          variant="bare"
          className={joinClassNames([
            'ml-1 cursor-pointer p-0 text-size-caption whitespace-nowrap text-light-primary hover:underline focus-visible:underline dark:text-dark-primary',
            FOCUS_RING,
          ])}
          onClick={onCancel}
          data-testid="row-action-cancel"
        >
          Cancel
        </Button>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {work.announcement}
      </span>
    </div>
  )
}

export function TableDataInfo({ info }: { info: TableDataInfoState }) {
  return (
    <div className={QUERY_INFO} data-testid="table-data-info" aria-live="polite">
      <span className={STATUS_TEXT} data-testid="table-data-rows">
        <span className={QUERY_INFO_LABEL}>Rows</span>{' '}
        <b className={QUERY_INFO_VALUE}>{info.visibleRows}</b>
      </span>
      {info.executionTimeMs !== null && (
        <span className={STATUS_TEXT} data-testid="table-data-time">
          <span className={QUERY_INFO_LABEL}>Exec</span>{' '}
          <b className={QUERY_INFO_VALUE}>{info.executionTimeMs} ms</b>
        </span>
      )}
    </div>
  )
}

export function QueryInfo({
  result,
  rowCount,
}: {
  result: SingleResultState
  rowCount: RowCountParts
}) {
  return (
    <div className={QUERY_INFO} data-testid="query-info">
      <span className={STATUS_TEXT} data-testid="query-rows">
        <b className={joinClassNames([QUERY_INFO_VALUE, 'inline-flex items-center gap-1'])}>
          {rowCount.segmentKind === 'truncated' && (
            <WarningCircle
              size={12}
              weight="fill"
              className="flex-none text-light-warning dark:text-dark-warning"
              aria-hidden="true"
              data-testid="query-rows-truncated-icon"
            />
          )}
          {rowCountText(rowCount)}
        </b>
      </span>
      <span className={STATUS_TEXT} data-testid="query-time">
        <span className={QUERY_INFO_LABEL}>Exec</span>{' '}
        <b className={QUERY_INFO_VALUE}>{result.executionTimeMs} ms</b>
      </span>
      <span className={STATUS_TEXT} data-testid="query-total-time">
        <span className={QUERY_INFO_LABEL}>Total</span>{' '}
        <b className={QUERY_INFO_VALUE}>{result.totalTimeMs} ms</b>
      </span>
    </div>
  )
}

export function UpdateIndicator({ onOpenUpdates }: { onOpenUpdates: () => void }) {
  return (
    <Button
      variant="bare"
      className={joinClassNames([
        'group/update flex shrink-0 cursor-pointer items-center gap-1 p-0',
        FOCUS_RING,
      ])}
      data-testid="status-bar-update-indicator"
      aria-label="Update available, click to open update settings"
      onClick={onOpenUpdates}
    >
      <ArrowsClockwise size={12} weight="fill" className={INDEXING_ICON} />
      <span className="whitespace-nowrap text-size-caption text-light-primary group-hover/update:underline group-focus-visible/update:underline dark:text-dark-primary">
        Update available
      </span>
    </Button>
  )
}

export function IdleStatusBar({ updateIndicator }: { updateIndicator: ReactNode }) {
  return (
    <div className={STATUS_BAR} data-testid="status-bar">
      <div className={STATUS_BAR_LEFT}>
        <span className={STATUS_TEXT}>Ready</span>
      </div>
      <div className={STATUS_BAR_SPACER} />
      <div className={STATUS_BAR_RIGHT}>
        <div className={STATUS_BAR_ACTIVITY} aria-live="polite">
          {updateIndicator}
        </div>
      </div>
    </div>
  )
}
