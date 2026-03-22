import { useConnectionStore } from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { WorkspaceTabs } from '../workspace/WorkspaceTabs'
import { TableDataPlaceholder } from '../workspace/TableDataPlaceholder'
import { SchemaInfoTab } from '../schema-info/SchemaInfoTab'
import type { WorkspaceTab } from '../../types/schema'
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

  // No active connection → welcome screen
  if (!activeConnection) {
    return (
      <div className={styles.workspace} data-testid="workspace-area">
        <div className={styles.welcomeCard}>
          <h2 className={styles.welcomeTitle}>Welcome!</h2>
          <p className={styles.welcomeMessage}>Connect to a MySQL server to get started</p>
          <button className="ui-button-primary" type="button" onClick={openDialog}>
            + New Connection
          </button>
        </div>
      </div>
    )
  }

  // Active connection but no workspace tabs → connected placeholder
  if (tabs.length === 0) {
    return (
      <div className={styles.workspace} data-testid="workspace-area">
        <div className={styles.connectedPlaceholder}>
          <p className={styles.connectedText}>
            Connected to {activeConnection.profile.name} ({activeConnection.profile.host}:
            {activeConnection.profile.port})
          </p>
        </div>
      </div>
    )
  }

  // Active connection with workspace tabs
  return (
    <div className={styles.workspaceTabbed} data-testid="workspace-area">
      <WorkspaceTabs connectionId={activeTabId!} />
      <div className={styles.workspaceScroll}>
        <div className={styles.tabContent}>
          {activeTab?.type === 'table-data' && (
            <TableDataPlaceholder
              databaseName={activeTab.databaseName}
              tableName={activeTab.objectName}
            />
          )}
          {activeTab?.type === 'schema-info' && <SchemaInfoTab key={activeTab.id} tab={activeTab} />}
          {activeTab?.type === 'query-editor' && (
            <div className={styles.queryEditorPlaceholder} data-testid="query-editor-placeholder">
              <p>Query editor — coming in a future phase</p>
            </div>
          )}
          {!activeTab && (
            <div className={styles.connectedPlaceholder}>
              <p className={styles.connectedText}>Select a tab to view content</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
