import type { ReactNode } from 'react'
import { Database, ArrowsClockwise, WarningCircle } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import type { SingleResultState } from '../../../stores/query-store'
import type { ConnectionIndexState } from '../../../stores/schema-index-store'
import {
  INDEX_FLASH_DISPLAY,
  PREPARING_PHASE,
  rowCountText,
  type FlashType,
  type IndexingProgress,
  type RowCountParts,
} from './status-bar-model'
import styles from '../StatusBar.module.css'

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
      className={styles.indexingIndicator}
      data-testid="indexing-indicator"
      data-phase={phase}
      {...accessibilityProps}
    >
      <Database size={12} className={`${styles.indexingIcon} ${styles.indexingIconAnimated}`} />
      <span className={styles.indexingText} data-testid="indexing-text">
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
  const fadeClassName = fadingOut ? styles.indexingFadeOut : ''
  return (
    <div className={`${styles.indexingIndicator} ${fadeClassName}`} data-testid={display.testId}>
      <Icon size={12} weight="fill" className={`${styles.indexingIcon} ${display.toneClassName}`} />
      <span className={`${styles.indexingText} ${display.toneClassName}`}>{display.text}</span>
    </div>
  )
}

export function QueryRunningInfo() {
  return (
    <div className={styles.queryRunningInfo} data-testid="query-running-info">
      <span className={styles.queryRunningSpinner} />
      <span className={styles.queryRunningText}>Running...</span>
    </div>
  )
}

export function TableDataInfo({ visibleRows }: { visibleRows: number }) {
  return (
    <div className={styles.queryInfo} data-testid="table-data-info">
      <span className={styles.queryInfoItem} data-testid="table-data-rows">
        <span className={styles.queryInfoLabel}>Rows</span>{' '}
        <b className={styles.queryInfoTime}>{visibleRows}</b>
      </span>
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
    <div className={styles.queryInfo} data-testid="query-info">
      <span className={styles.queryInfoItem} data-testid="query-rows">
        <b className={`${styles.queryInfoTime} ${styles.queryRowCount}`}>
          {rowCount.segmentKind === 'truncated' && (
            <WarningCircle
              size={12}
              weight="fill"
              className={styles.queryRowCountWarning}
              aria-hidden="true"
              data-testid="query-rows-truncated-icon"
            />
          )}
          {rowCountText(rowCount)}
        </b>
      </span>
      <span className={styles.queryInfoItem} data-testid="query-time">
        <span className={styles.queryInfoLabel}>Exec</span>{' '}
        <b className={styles.queryInfoTime}>{result.executionTimeMs} ms</b>
      </span>
      <span className={styles.queryInfoItem} data-testid="query-total-time">
        <span className={styles.queryInfoLabel}>Total</span>{' '}
        <b className={styles.queryInfoTime}>{result.totalTimeMs} ms</b>
      </span>
    </div>
  )
}

export function UpdateIndicator({ onOpenUpdates }: { onOpenUpdates: () => void }) {
  return (
    <Button
      variant="bare"
      className={styles.updateButton}
      data-testid="status-bar-update-indicator"
      aria-label="Update available, click to open update settings"
      onClick={onOpenUpdates}
    >
      <ArrowsClockwise size={12} weight="fill" className={styles.indexingIcon} />
      <span className={styles.updateButtonText}>Update available</span>
    </Button>
  )
}

export function IdleStatusBar({ updateIndicator }: { updateIndicator: ReactNode }) {
  return (
    <div className={styles.statusBar} data-testid="status-bar">
      <div className={styles.left}>
        <span className={styles.statusText}>Ready</span>
      </div>
      <div className={styles.spacer} />
      <div className={styles.right}>
        <div className={styles.activity} aria-live="polite">
          {updateIndicator}
        </div>
      </div>
    </div>
  )
}
