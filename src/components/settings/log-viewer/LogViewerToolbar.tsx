import { ArrowsClockwise, FileArrowDown } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { Dropdown, type DropdownOption } from '../../common/Dropdown'
import { IconButton } from '../../common/IconButton'
import type { LogLevelFilter } from '../../../lib/log-commands'
import type { LogPages } from './use-log-pages'
import styles from '../LogViewer.module.css'

const LEVEL_OPTIONS: DropdownOption<LogLevelFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'error', label: 'Error+' },
  { value: 'warn', label: 'Warn+' },
  { value: 'info', label: 'Info+' },
  { value: 'debug', label: 'Debug+' },
  { value: 'trace', label: 'Trace' },
]

function AutoRefreshToggle({ logPages }: { logPages: LogPages }) {
  const { autoRefresh } = logPages
  return (
    <Button
      variant="bare"
      aria-label="Auto-refresh"
      aria-pressed={autoRefresh}
      onClick={logPages.toggleAutoRefresh}
      className={`${styles.autoRefreshToggle} ${autoRefresh ? styles.autoRefreshActive : ''}`}
      data-testid="log-viewer-auto-refresh-status"
    >
      <span className={autoRefresh ? styles.pulseDot : styles.pulseDotOff} aria-hidden="true" />
      {autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'}
    </Button>
  )
}

interface LogViewerToolbarProps {
  logPages: LogPages
  onExport: () => void
}

export function LogViewerToolbar({ logPages, onExport }: LogViewerToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.toolbarLeft}>
        <Dropdown
          id="log-viewer-level-filter"
          ariaLabel="Severity level"
          options={LEVEL_OPTIONS}
          value={logPages.levelFilter}
          onChange={logPages.changeLevel}
          data-testid="log-viewer-level-filter"
          triggerClassName={styles.filterDropdown}
        />
      </div>

      <div className={styles.toolbarRight}>
        <IconButton
          aria-label="Refresh logs"
          title="Refresh logs"
          onClick={logPages.refresh}
          className={`${styles.refreshButton} ${logPages.isRefreshing ? styles.refreshing : ''}`}
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
