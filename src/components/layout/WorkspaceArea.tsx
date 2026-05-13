import { useEffect, useRef } from 'react'
import { Button } from '../common/Button'
import { useConnectionStore } from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import {
  dispatchWorkspaceTabActivated,
  dispatchWorkspaceTabDeactivated,
} from '../../lib/workspace-tab-activity-events'
import { WorkspaceTabs } from '../workspace/WorkspaceTabs'
import { AiDiffBridgeProvider } from '../query-editor/ai-diff-bridge-context'
import type { WorkspaceTab } from '../../types/schema'
import { WorkspaceBody } from './WorkspaceBody'
import { WorkspaceTabPanel } from './WorkspaceTabPanel'
import styles from './WorkspaceArea.module.css'

const EMPTY_TABS: WorkspaceTab[] = []

export function WorkspaceArea() {
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const activeTabId = useConnectionStore((state) => state.activeTabId)
  const openDialog = useConnectionStore((state) => state.openDialog)

  const activeConnection = activeTabId ? activeConnections[activeTabId] : null

  const tabs = useWorkspaceStore((state) =>
    activeTabId ? (state.tabsByConnection[activeTabId] ?? EMPTY_TABS) : EMPTY_TABS
  )
  const activeWorkspaceTabId = useWorkspaceStore((state) =>
    activeTabId ? (state.activeTabByConnection[activeTabId] ?? null) : null
  )

  const activeTab = tabs.find((t) => t.id === activeWorkspaceTabId) ?? null
  const previousActiveWorkspaceTabIdRef = useRef<string | null>(null)

  useEffect(() => {
    const previousTabId = previousActiveWorkspaceTabIdRef.current
    if (previousTabId === activeWorkspaceTabId) {
      return
    }

    if (previousTabId && activeTabId) {
      dispatchWorkspaceTabDeactivated(previousTabId, activeTabId)
    }
    if (activeWorkspaceTabId && activeTabId) {
      dispatchWorkspaceTabActivated(activeWorkspaceTabId, activeTabId)
    }
    previousActiveWorkspaceTabIdRef.current = activeWorkspaceTabId
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

  // Active connection — always show tab bar (even with 0 tabs)
  return (
    <div className={styles.workspaceTabbed} data-testid="workspace-area">
      <WorkspaceTabs connectionId={activeTabId!} />
      <AiDiffBridgeProvider>
        <WorkspaceBody
          tabs={tabs}
          activeTabId={activeWorkspaceTabId}
          connectionId={activeTabId!}
          sessionId={activeTabId!}
          renderTabStack={({
            tabs: stackTabs,
            activeTabId: stackActiveTabId,
            connectionId,
            sessionId,
          }) => (
            <div className={styles.panelStack}>
              {activeConnection && stackTabs.length === 0 && (
                <div className={styles.connectedPlaceholder}>
                  <p className={styles.connectedText}>
                    Connected to {activeConnection.profile.name} ({activeConnection.profile.host}:
                    {activeConnection.profile.port})
                  </p>
                </div>
              )}
              {stackTabs.map((tab) => (
                <WorkspaceTabPanel
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === stackActiveTabId}
                  connectionId={connectionId}
                  sessionId={sessionId}
                />
              ))}
              {stackTabs.length > 0 && !activeTab && (
                <div className={styles.connectedPlaceholder}>
                  <p className={styles.connectedText}>Select a tab to view content</p>
                </div>
              )}
            </div>
          )}
        />
      </AiDiffBridgeProvider>
    </div>
  )
}
