import { useEffect, useRef } from 'react'
import { Database, Plus } from '@phosphor-icons/react'
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

type PendingCascadeClose = ReturnType<typeof useWorkspaceStore.getState>['pendingCascadeClose']

function useWorkspaceTabActivityEvents(
  activeTabId: string | null,
  activeWorkspaceTabId: string | null
): void {
  const previousActiveWorkspaceTabIdRef = useRef<string | null>(null)
  const previousActiveConnectionIdRef = useRef<string | null>(null)

  useEffect(() => {
    const previousTabId = previousActiveWorkspaceTabIdRef.current
    const previousConnectionId = previousActiveConnectionIdRef.current

    const isUnchanged =
      previousTabId === activeWorkspaceTabId && previousConnectionId === activeTabId
    if (isUnchanged) {
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
}

function WelcomeScreen({ onOpenDialog }: { onOpenDialog: () => void }) {
  return (
    <div className={styles.workspace} data-testid="workspace-area">
      <div className={styles.welcome}>
        <div className={styles.welcomeTile} aria-hidden="true">
          <Database size={32} weight="light" />
        </div>
        <h2 className={styles.welcomeTitle}>Connect to a server</h2>
        <p className={styles.welcomeMessage}>
          Open a saved MySQL or MariaDB connection, or add a new one.
        </p>
        <div className={styles.welcomeActions}>
          <Button variant="accent" onClick={onOpenDialog}>
            <Plus size={16} weight="regular" aria-hidden="true" />
            New connection
          </Button>
        </div>
      </div>
    </div>
  )
}

function CascadeItems({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <strong>{title}</strong>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

function CascadeCloseMessage({ pending }: { pending: PendingCascadeClose }) {
  if (!pending) return null
  return (
    <div>
      <p>Closing this tab will discard changes in:</p>
      <CascadeItems title="Query results" items={pending.queryResultItems} />
      <CascadeItems title="Table data tabs" items={pending.tableDataItems} />
    </div>
  )
}

function CascadeCloseDialog({ pending }: { pending: PendingCascadeClose }) {
  return (
    <ConfirmDialog
      isOpen={pending != null}
      title="Discard unsaved changes?"
      message={<CascadeCloseMessage pending={pending} />}
      confirmLabel="Discard and close"
      isDestructive
      onConfirm={() => pending?.onConfirm()}
      onCancel={() => pending?.onCancel()}
    />
  )
}

export function WorkspaceArea() {
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const activeTabId = useConnectionStore((state) => state.activeTabId)
  const openDialog = useConnectionStore((state) => state.openDialog)
  const activeConnection = activeTabId ? activeConnections[activeTabId] : null
  const activeWorkspaceTabId = useWorkspaceStore((state) =>
    activeTabId ? (state.activeTabByConnection[activeTabId] ?? null) : null
  )
  const pendingCascadeClose = useWorkspaceStore((state) => state.pendingCascadeClose)
  useWorkspaceTabActivityEvents(activeTabId, activeWorkspaceTabId)

  if (!activeConnection) return <WelcomeScreen onOpenDialog={openDialog} />

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
      <CascadeCloseDialog pending={pendingCascadeClose} />
    </div>
  )
}
