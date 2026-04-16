import { Button } from '../common/Button'
import { useConnectionStore } from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useSettingsStore } from '../../stores/settings-store'
import { WorkspaceTabs } from '../workspace/WorkspaceTabs'
import { TableDataTab } from '../table-data/TableDataTab'
import { SchemaInfoTab } from '../schema-info/SchemaInfoTab'
import { QueryEditorTab } from '../query-editor/QueryEditorTab'
import { AiDiffBridgeProvider } from '../query-editor/ai-diff-bridge-context'
import { WorkspaceAiResizableRow } from './WorkspaceAiResizableRow'
import { TableDesignerTab as TableDesignerTabComponent } from '../table-designer/TableDesignerTab'
import { ObjectEditorTab as ObjectEditorTabComponent } from '../object-editor/ObjectEditorTab'
import { HistoryTab as HistoryTabComponent } from '../history/HistoryTab'
import type {
  WorkspaceTab,
  SchemaInfoTab as SchemaInfoTabType,
  QueryEditorTab as QueryEditorTabType,
  TableDesignerTab as TableDesignerTabType,
  ObjectEditorTab as ObjectEditorTabType,
  HistoryTab as HistoryTabType,
} from '../../types/schema'
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

  const aiEnabled = useSettingsStore((s) => s.getSetting('ai.enabled') === 'true')
  const queryEditorTab =
    activeTab?.type === 'query-editor' ? (activeTab as QueryEditorTabType) : null
  const useAiResizeLayout = Boolean(aiEnabled && queryEditorTab)

  const tabContent = (
    <>
      {/* No tabs: connected placeholder */}
      {activeConnection && tabs.length === 0 && (
        <div className={styles.connectedPlaceholder}>
          <p className={styles.connectedText}>
            Connected to {activeConnection.profile.name} ({activeConnection.profile.host}:
            {activeConnection.profile.port})
          </p>
        </div>
      )}
      {/* Active tab content */}
      {activeTab?.type === 'table-data' && <TableDataTab key={activeTab.id} tab={activeTab} />}
      {activeTab?.type === 'schema-info' && (
        <SchemaInfoTab key={activeTab.id} tab={activeTab as SchemaInfoTabType} />
      )}
      {activeTab?.type === 'query-editor' && (
        <QueryEditorTab key={activeTab.id} tab={activeTab as QueryEditorTabType} />
      )}
      {activeTab?.type === 'table-designer' && (
        <TableDesignerTabComponent key={activeTab.id} tab={activeTab as TableDesignerTabType} />
      )}
      {activeTab?.type === 'object-editor' && (
        <ObjectEditorTabComponent key={activeTab.id} tab={activeTab as ObjectEditorTabType} />
      )}
      {activeTab?.type === 'history' && (
        <HistoryTabComponent key={activeTab.id} tab={activeTab as HistoryTabType} />
      )}
      {/* Tabs exist but none active */}
      {tabs.length > 0 && !activeTab && (
        <div className={styles.connectedPlaceholder}>
          <p className={styles.connectedText}>Select a tab to view content</p>
        </div>
      )}
    </>
  )

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
        {useAiResizeLayout ? (
          <WorkspaceAiResizableRow tab={queryEditorTab!}>{tabContent}</WorkspaceAiResizableRow>
        ) : (
          <div className={styles.workspaceMain}>
            <div className={styles.workspaceScroll}>
              <div className={styles.tabContent}>{tabContent}</div>
            </div>
          </div>
        )}
      </AiDiffBridgeProvider>
    </div>
  )
}
