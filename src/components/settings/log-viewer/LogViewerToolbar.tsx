import { ArrowsClockwise, FileArrowDown } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { Dropdown, type DropdownOption } from '../../common/Dropdown'
import { IconButton } from '../../common/IconButton'
import type { LogLevelFilter } from '../../../lib/log-commands'
import type { LogPages } from './use-log-pages'
import { joinClassNames } from '../../../lib/class-names'
import { FOCUS_RING } from '../../../lib/focus-ring'

const LEVEL_OPTIONS: DropdownOption<LogLevelFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'error', label: 'Error+' },
  { value: 'warn', label: 'Warn+' },
  { value: 'info', label: 'Info+' },
  { value: 'debug', label: 'Debug+' },
  { value: 'trace', label: 'Trace' },
]

type AutoRefreshState = 'on' | 'off'

const AUTO_REFRESH_TOGGLE_CLASSES: Record<AutoRefreshState, string> = {
  on: 'border-light-tertiary-a35 text-light-tertiary dark:border-dark-tertiary-a35 dark:text-dark-tertiary',
  off: 'border-light-stroke-card text-light-on-surface-variant dark:border-dark-stroke-card dark:text-dark-on-surface-variant',
}

const AUTO_REFRESH_DOT_CLASSES: Record<AutoRefreshState, string> = {
  on: 'bg-light-tertiary motion-safe:animate-pulse-ripple-light motion-safe:window-blurred:animate-pulse-ripple-light-paused dark:bg-dark-tertiary dark:motion-safe:animate-pulse-ripple-dark dark:motion-safe:window-blurred:animate-pulse-ripple-dark-paused',
  off: 'bg-light-on-surface-variant opacity-40 dark:bg-dark-on-surface-variant',
}

const AUTO_REFRESH_LABELS: Record<AutoRefreshState, string> = {
  on: 'Auto-refresh on',
  off: 'Auto-refresh off',
}

function autoRefreshStateOf(autoRefresh: boolean): AutoRefreshState {
  if (autoRefresh) return 'on'
  return 'off'
}

function AutoRefreshToggle({ logPages }: { logPages: LogPages }) {
  const { autoRefresh } = logPages
  const state = autoRefreshStateOf(autoRefresh)
  return (
    <Button
      variant="bare"
      aria-label="Auto-refresh"
      aria-pressed={autoRefresh}
      onClick={logPages.toggleAutoRefresh}
      className={joinClassNames([
        'inline-flex cursor-pointer items-center gap-1.5 rounded-pill border bg-transparent px-2.5 py-1 text-size-caption font-semibold whitespace-nowrap transition-color-border-background duration-150 hover:border-light-primary-a35 dark:hover:border-dark-primary-a35',
        FOCUS_RING,
        AUTO_REFRESH_TOGGLE_CLASSES[state],
      ])}
      data-testid="log-viewer-auto-refresh-status"
    >
      <span
        className={joinClassNames(['size-2 rounded-pill', AUTO_REFRESH_DOT_CLASSES[state]])}
        aria-hidden="true"
      />
      {AUTO_REFRESH_LABELS[state]}
    </Button>
  )
}

const REFRESH_ICON_CLASSES: Record<'idle' | 'refreshing', string> = {
  idle: '',
  refreshing: 'motion-safe:animate-spin-800ms motion-safe:window-blurred:animate-spin-800ms-paused',
}

function refreshStateOf(isRefreshing: boolean): 'idle' | 'refreshing' {
  if (isRefreshing) return 'refreshing'
  return 'idle'
}

interface LogViewerToolbarProps {
  logPages: LogPages
  onExport: () => void
}

export function LogViewerToolbar({ logPages, onExport }: LogViewerToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-light-stroke-divider bg-light-surface-container-lowest p-3 dark:border-dark-stroke-divider dark:bg-dark-surface-container-lowest">
      <div className="flex min-w-0 items-center gap-2">
        <Dropdown
          id="log-viewer-level-filter"
          ariaLabel="Severity level"
          options={LEVEL_OPTIONS}
          value={logPages.levelFilter}
          onChange={logPages.changeLevel}
          data-testid="log-viewer-level-filter"
          triggerClassName="min-w-42"
        />
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <IconButton
          aria-label="Refresh logs"
          title="Refresh logs"
          onClick={logPages.refresh}
          tone="mutedAccentOnHover"
          className={REFRESH_ICON_CLASSES[refreshStateOf(logPages.isRefreshing)]}
          data-testid="log-viewer-refresh"
        >
          <ArrowsClockwise size={16} weight="bold" />
        </IconButton>
        <AutoRefreshToggle logPages={logPages} />
        <Button variant="subtle" size="sm" onClick={onExport} data-testid="log-viewer-export">
          <FileArrowDown size={14} weight="bold" />
          Export
        </Button>
      </div>
    </div>
  )
}
