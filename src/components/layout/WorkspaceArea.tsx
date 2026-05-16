import { useEffect, useRef } from 'react'
import { Button } from '../common/Button'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { useConnectionStore } from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../stores/settings-store'
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

  // Read the committed "tableTabsInBottomPanel" setting reactively.
  // Using state.settings directly (not getSetting function reference) so that
  // the component re-renders when settings are saved.
  const bottomTableTabsEnabled = useSettingsStore(
    (state) =>
      (state.settings['results.tableTabsInBottomPanel'] ??
        SETTINGS_DEFAULTS['results.tableTabsInBottomPanel']) === 'true'
  )

  const activeConnection = activeTabId ? activeConnections[activeTabId] : null

  const tabs = useWorkspaceStore((state) =>
    activeTabId ? (state.tabsByConnection[activeTabId] ?? EMPTY_TABS) : EMPTY_TABS
  )
  const activeWorkspaceTabId = useWorkspaceStore((state) =>
    activeTabId ? (state.activeTabByConnection[activeTabId] ?? null) : null
  )
  const pendingCascadeClose = useWorkspaceStore((state) => state.pendingCascadeClose)

  const activeTab = tabs.find((t) => t.id === activeWorkspaceTabId) ?? null
  const previousActiveWorkspaceTabIdRef = useRef<string | null>(null)
  const panelOrderRef = useRef<string[]>([])

  const nextPanelOrder = panelOrderRef.current.filter((tabId) =>
    tabs.some((tab) => tab.id === tabId)
  )
  const seenPanelIds = new Set(nextPanelOrder)
  for (const tab of tabs) {
    if (!seenPanelIds.has(tab.id)) {
      nextPanelOrder.push(tab.id)
      seenPanelIds.add(tab.id)
    }
  }
  panelOrderRef.current = nextPanelOrder

  const panelTabs = nextPanelOrder
    .map((tabId) => tabs.find((tab) => tab.id === tabId) ?? null)
    .filter((tab): tab is WorkspaceTab => tab != null)
    .filter(
      (tab) =>
        !(
          bottomTableTabsEnabled &&
          tab.type === 'table-data' &&
          tab.parentQueryTabId !== undefined
        )
    )

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
      <WorkspaceTabs connectionId={activeTabId!} hideTableDataTabs={bottomTableTabsEnabled} />
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
              {stackTabs.length === 0 && (
                <div className={styles.connectedPlaceholder}>
                  <p className={styles.connectedText}>
                    Connected to {activeConnection.profile.name} ({activeConnection.profile.host}:
                    {activeConnection.profile.port})
                  </p>
                </div>
              )}
              {panelTabs.map((tab) => (
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
