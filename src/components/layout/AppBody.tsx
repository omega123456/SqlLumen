import { ConnectionsPage } from '../connections-page/ConnectionsPage'
import { MainPanels } from './MainPanels'
import { useConnectionStore } from '../../stores/connection-store'
import { useConnectionsPageStore } from '../../stores/connections-page-store'
import { useSessionRestoreStore } from '../../stores/session-restore-store'
import { RETAINED_HIDDEN_STYLE } from '../../lib/retained-hidden-style'

function mainPanelsVisibilityProps(isCovered: boolean) {
  if (!isCovered) {
    return {
      className: 'relative flex min-h-0 flex-1 flex-col',
      'aria-hidden': undefined,
      inert: undefined,
    }
  }
  return {
    className: 'pointer-events-none absolute inset-0 flex min-h-0 flex-col aria-hidden:invisible',
    style: RETAINED_HIDDEN_STYLE,
    'data-animation-paused': true,
    'aria-hidden': true,
    inert: true,
  }
}

function useIsStartupPending(): boolean {
  const hasRestoreSettled = useSessionRestoreStore((state) => state.hasRestoreSettled)
  const isRestoring = useSessionRestoreStore((state) => state.isRestoring)
  if (!hasRestoreSettled) return true
  return isRestoring
}

function EmptySurface() {
  return (
    <div
      className="min-h-0 flex-1 bg-light-surface-container dark:bg-dark-surface-container"
      data-testid="app-body-pending"
    />
  )
}

export function AppBody() {
  const isStartupPending = useIsStartupPending()
  const hasSessions = useConnectionStore((state) => Object.keys(state.activeConnections).length > 0)
  const isPageOpen = useConnectionsPageStore((state) => state.isOpen)
  const showsPage = isPageOpen || !hasSessions

  if (isStartupPending) return <EmptySurface />

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div {...mainPanelsVisibilityProps(showsPage)} data-testid="main-panels">
        <MainPanels />
      </div>
      {showsPage && <ConnectionsPage />}
    </div>
  )
}
