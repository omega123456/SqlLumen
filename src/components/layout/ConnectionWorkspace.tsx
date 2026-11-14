/**
 * ConnectionWorkspace — one open connection session's retained workspace subtree.
 *
 * `WorkspaceArea` renders one `ConnectionWorkspace` per open runtime session and
 * keeps every instance mounted for the lifetime of the connection. Exactly one
 * connection workspace is visible and interactive at a time; the others remain
 * mounted but hidden, pointer-disabled, removed from the accessibility tree, and
 * inert to keyboard focus.
 *
 * When `isActive` is false the component:
 *   - hides its root and pauses descendant animations (`visibility: hidden`,
 *     `content-visibility: hidden`,
 *     `animation-play-state: paused`, `pointer-events: none`,
 *     `aria-hidden`, `inert`)
 *   - passes no visible active workspace tab into `WorkspaceBody`
 *   - marks every descendant `WorkspaceTabPanel` inactive
 *   - tells `WorkspaceTabs` its connection is inactive so the tab rail suppresses
 *     visible-only focus and scroll-into-view side effects
 *
 * Stable panel DOM order is maintained independently per session so retained
 * grids and editors keep their immediate scroll position and local UI state when
 * the user switches connections and returns.
 */
import { useState } from 'react'
import { useConnectionStore } from '../../stores/connection-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useBottomTableTabsEnabled } from '../../stores/settings-store'
import { WorkspaceTabs } from '../workspace/WorkspaceTabs'
import { FavoriteDialog } from '../history-favorites/FavoriteDialog'
import { useFavoritesStore } from '../../stores/favorites-store'
import { AiDiffBridgeProvider } from '../query-editor/ai-diff-bridge-context'
import type { WorkspaceTab } from '../../types/schema'
import { WorkspaceBody } from './WorkspaceBody'
import { WorkspaceTabPanel } from './WorkspaceTabPanel'
import styles from './WorkspaceArea.module.css'

const EMPTY_TABS: WorkspaceTab[] = []

function reconcilePanelOrder(panelOrder: string[], tabs: WorkspaceTab[]): string[] {
  const nextPanelOrder = panelOrder.filter((tabId) => tabs.some((tab) => tab.id === tabId))
  const seenIds = new Set(nextPanelOrder)
  for (const tab of tabs) {
    if (seenIds.has(tab.id)) continue
    nextPanelOrder.push(tab.id)
    seenIds.add(tab.id)
  }
  return nextPanelOrder
}

function isBottomPanelTableTab(tab: WorkspaceTab, bottomTableTabsEnabled: boolean): boolean {
  if (!bottomTableTabsEnabled) return false
  return tab.type === 'table-data' && tab.parentQueryTabId !== undefined
}

function workspaceVisibilityProps(isActive: boolean) {
  if (isActive) {
    return {
      className: `${styles.connectionWorkspace} ${styles.connectionWorkspaceActive}`,
      'data-testid': 'active-connection-workspace',
      'aria-hidden': undefined,
      inert: undefined,
    }
  }
  return {
    className: `${styles.connectionWorkspace} ${styles.connectionWorkspaceInactive}`,
    'data-testid': 'inactive-connection-workspace',
    'aria-hidden': true,
    inert: true,
  }
}

export interface ConnectionWorkspaceProps {
  sessionId: string
  isActive: boolean
}

type ActiveConnection = NonNullable<
  ReturnType<typeof useConnectionStore.getState>['activeConnections'][string]
>

interface TabPanelStackProps {
  tabs: WorkspaceTab[]
  panelTabs: WorkspaceTab[]
  visibleActiveWorkspaceTabId: string | null
  sessionId: string
  activeConnection: ActiveConnection
}

function TabPanelStack(stack: TabPanelStackProps) {
  const { tabs, panelTabs, visibleActiveWorkspaceTabId, sessionId, activeConnection } = stack
  const activeTab = tabs.find((tab) => tab.id === visibleActiveWorkspaceTabId) ?? null
  return (
    <div className={styles.panelStack}>
      {tabs.length === 0 && (
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
          isActive={tab.id === visibleActiveWorkspaceTabId}
          connectionId={sessionId}
          sessionId={sessionId}
        />
      ))}
      {tabs.length > 0 && !activeTab && (
        <div className={styles.connectedPlaceholder}>
          <p className={styles.connectedText}>Select a tab to view content</p>
        </div>
      )}
    </div>
  )
}

function useStablePanelTabs(tabs: WorkspaceTab[], bottomTableTabsEnabled: boolean) {
  const [panelOrder, setPanelOrder] = useState<string[]>(() => tabs.map((tab) => tab.id))
  const [previousTabs, setPreviousTabs] = useState(tabs)

  let nextPanelOrder = panelOrder
  if (previousTabs !== tabs) {
    nextPanelOrder = reconcilePanelOrder(panelOrder, tabs)
    setPanelOrder(nextPanelOrder)
    setPreviousTabs(tabs)
  }

  return nextPanelOrder
    .map((tabId) => tabs.find((tab) => tab.id === tabId) ?? null)
    .filter((tab): tab is WorkspaceTab => tab != null)
    .filter((tab) => !isBottomPanelTableTab(tab, bottomTableTabsEnabled))
}

export function ConnectionWorkspace({ sessionId, isActive }: ConnectionWorkspaceProps) {
  const activeConnection = useConnectionStore((state) => state.activeConnections[sessionId] ?? null)
  const bottomTableTabsEnabled = useBottomTableTabsEnabled()
  const favoriteDialogOpen = useFavoritesStore((state) => state.dialogOpen)
  const tabs = useWorkspaceStore((state) => state.tabsByConnection[sessionId] ?? EMPTY_TABS)
  const selectedWorkspaceTabId = useWorkspaceStore(
    (state) => state.activeTabByConnection[sessionId] ?? null
  )
  const visibleActiveWorkspaceTabId = isActive ? selectedWorkspaceTabId : null
  const panelTabs = useStablePanelTabs(tabs, bottomTableTabsEnabled)

  if (!activeConnection) {
    return null
  }

  return (
    <div {...workspaceVisibilityProps(isActive)} data-session-id={sessionId} data-active={isActive}>
      <WorkspaceTabs
        connectionId={sessionId}
        hideTableDataTabs={bottomTableTabsEnabled}
        connectionActive={isActive}
      >
        <AiDiffBridgeProvider>
          <WorkspaceBody
            tabs={tabs}
            activeTabId={visibleActiveWorkspaceTabId}
            connectionId={sessionId}
            sessionId={sessionId}
            renderTabStack={() => (
              <TabPanelStack
                tabs={tabs}
                panelTabs={panelTabs}
                visibleActiveWorkspaceTabId={visibleActiveWorkspaceTabId}
                sessionId={sessionId}
                activeConnection={activeConnection}
              />
            )}
          />
        </AiDiffBridgeProvider>
      </WorkspaceTabs>
      {isActive && favoriteDialogOpen && <FavoriteDialog connectionId={sessionId} />}
    </div>
  )
}
