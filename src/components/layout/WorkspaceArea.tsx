import { useEffect, useRef } from 'react'
import { Button } from '../common/Button'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { useConnectionStore } from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import {
  dispatchWorkspaceTabActivated,
  dispatchWorkspaceTabDeactivated,
} from '../../lib/workspace-tab-activity-events'
import { ConnectionWorkspace } from './ConnectionWorkspace'
import styles from './WorkspaceArea.module.css'

export function WorkspaceArea() {
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const activeTabId = useConnectionStore((state) => state.activeTabId)
  const openDialog = useConnectionStore((state) => state.openDialog)

  const activeConnection = activeTabId ? activeConnections[activeTabId] : null

  const activeWorkspaceTabId = useWorkspaceStore((state) =>
    activeTabId ? (state.activeTabByConnection[activeTabId] ?? null) : null
  )
  const pendingCascadeClose = useWorkspaceStore((state) => state.pendingCascadeClose)

  // Shell-level coordinator for the globally visible workspace-tab activity
  // transition. Retained `ConnectionWorkspace` instances render their session UI
  // but do not independently emit global activity events. Every visible-tab
  // transition (whether from a workspace-tab change or a connection switch)
  // emits the previous deactivation before the next activation, exactly once,
  // with each event's correct connection context.
  const previousActiveWorkspaceTabIdRef = useRef<string | null>(null)
  const previousActiveConnectionIdRef = useRef<string | null>(null)

  useEffect(() => {
    const previousTabId = previousActiveWorkspaceTabIdRef.current
    const previousConnectionId = previousActiveConnectionIdRef.current

    if (previousTabId === activeWorkspaceTabId && previousConnectionId === activeTabId) {
      return
    }

    if (previousTabId && previousConnectionId) {
      dispatchWorkspaceTabDeactivated(previousTabId, previousConnectionId)
    }
    if (activeWorkspaceTabId && activeTabId) {
      dispatchWorkspaceTabActivated(activeWorkspaceTabId, activeTabId)
    }
    previousActiveWorkspaceTabIdRef.current = activeWorkspaceTabId
    previousActiveConnectionIdRef.current = activeTabId
  }, [activeTabId, activeWorkspaceTabId])

  // No active connection → welcome screen
  if (!activeConnection) {
    return (
      <div className={styles.workspace} data-testid="workspace-area">
        <div className={styles.welcomeCard}>
          <h2 className={styles.welcomeTitle}>Welcome!</h2>
          <p className={styles.welcomeMessage}>Connect to a MySQL server to get started</p>
          <Button variant="primary" onClick={openDialog}>
            + New Connection
          </Button>
        </div>
      </div>
    )
  }

  // Retain one workspace subtree per open connection session. Exactly one is
  // visible and interactive; the rest stay mounted but hidden and inert.
  return (
    <div className={styles.workspaceTabbed} data-testid="workspace-area">
      <div className={styles.connectionWorkspaceStack}>
        {Object.keys(activeConnections).map((sessionId) => (
          <ConnectionWorkspace
            key={sessionId}
            sessionId={sessionId}
            isActive={sessionId === activeTabId}
          />
        ))}
      </div>
      <ConfirmDialog
        isOpen={pendingCascadeClose != null}
        title="Discard unsaved changes?"
        message={
          pendingCascadeClose ? (
            <div>
              <p>Closing this tab will discard changes in:</p>
              {pendingCascadeClose.queryResultItems.length > 0 && (
                <div>
                  <strong>Query results</strong>
                  <ul>
                    {pendingCascadeClose.queryResultItems.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {pendingCascadeClose.tableDataItems.length > 0 && (
                <div>
                  <strong>Table data tabs</strong>
                  <ul>
                    {pendingCascadeClose.tableDataItems.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null
        }
        confirmLabel="Discard and Close"
        isDestructive
        onConfirm={() => pendingCascadeClose?.onConfirm()}
        onCancel={() => pendingCascadeClose?.onCancel()}
      />
    </div>
  )
}
