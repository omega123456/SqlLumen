import { useEffect, type KeyboardEvent } from 'react'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { useConnectionStore } from '../../stores/connection-store'
import {
  useConnectionsPageStore,
  type ConnectionsPageView,
  type ProfileTarget,
} from '../../stores/connections-page-store'
import { SUBTLE_THIN_SCROLLBAR, joinClassNames } from '../../lib/class-names'
import { ConnectionsBoard } from './board/ConnectionsBoard'
import { ProfileView } from './profile/ProfileView'

const NEW_PROFILE_KEY = 'new'

function profileTargetKey(target: ProfileTarget): string {
  if (target.kind === 'existing') return target.profileId
  return NEW_PROFILE_KEY
}

function PageView({ view }: { view: ConnectionsPageView }) {
  if (view.kind === 'profile') {
    return <ProfileView key={profileTargetKey(view.target)} target={view.target} />
  }
  return <ConnectionsBoard />
}

function isInsidePage(event: KeyboardEvent<HTMLElement>): boolean {
  const target = event.target
  if (!(target instanceof Node)) return false
  return event.currentTarget.contains(target)
}

function leaveCurrentView(hasSession: boolean): void {
  const page = useConnectionsPageStore.getState()
  const isOnProfile = page.view.kind === 'profile'
  if (isOnProfile) {
    page.requestLeave(page.showBoard)
    return
  }
  if (hasSession) page.closePage()
}

function useLeaveOnEscape(): (event: KeyboardEvent<HTMLElement>) => void {
  const hasSession = useConnectionStore((state) => state.activeTabId !== null)
  return (event) => {
    if (event.key !== 'Escape') return
    if (event.defaultPrevented) return
    if (!isInsidePage(event)) return
    leaveCurrentView(hasSession)
  }
}

function LeaveConfirmDialog() {
  const pendingLeave = useConnectionsPageStore((state) => state.pendingLeave)
  const confirmLeave = useConnectionsPageStore((state) => state.confirmLeave)
  const cancelLeave = useConnectionsPageStore((state) => state.cancelLeave)
  return (
    <ConfirmDialog
      isOpen={pendingLeave !== null}
      title="Discard unsaved changes?"
      message="Your edits to this connection have not been saved."
      confirmLabel="Discard changes"
      isDestructive
      onConfirm={confirmLeave}
      onCancel={cancelLeave}
    />
  )
}

export function ConnectionsPage() {
  const view = useConnectionsPageStore((state) => state.view)
  const fetchSavedConnections = useConnectionStore((state) => state.fetchSavedConnections)
  const handleKeyDown = useLeaveOnEscape()

  useEffect(() => {
    void fetchSavedConnections()
  }, [fetchSavedConnections])

  return (
    <div
      className={joinClassNames([
        'relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-light-surface-container dark:bg-dark-surface-container',
        SUBTLE_THIN_SCROLLBAR,
      ])}
      data-testid="connections-page"
      onKeyDown={handleKeyDown}
    >
      <PageView view={view} />
      <LeaveConfirmDialog />
    </div>
  )
}
