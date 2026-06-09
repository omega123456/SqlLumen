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
 *   - hides and disables its root (`visibility: hidden`, `pointer-events: none`,
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
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../stores/settings-store'
import { WorkspaceTabs } from '../workspace/WorkspaceTabs'
import { FavoriteDialog } from '../history-favorites/FavoriteDialog'
import { useFavoritesStore } from '../../stores/favorites-store'
import { AiDiffBridgeProvider } from '../query-editor/ai-diff-bridge-context'
import type { WorkspaceTab } from '../../types/schema'
import { WorkspaceBody } from './WorkspaceBody'
import { WorkspaceTabPanel } from './WorkspaceTabPanel'
import styles from './WorkspaceArea.module.css'

const EMPTY_TABS: WorkspaceTab[] = []

export interface ConnectionWorkspaceProps {
  sessionId: string
  isActive: boolean
}

export function ConnectionWorkspace({ sessionId, isActive }: ConnectionWorkspaceProps) {
  const activeConnection = useConnectionStore((state) => state.activeConnections[sessionId] ?? null)

  const bottomTableTabsEnabled = useSettingsStore(
    (state) =>
      (state.settings['results.tableTabsInBottomPanel'] ??
        SETTINGS_DEFAULTS['results.tableTabsInBottomPanel']) === 'true'
  )

  const favoriteDialogOpen = useFavoritesStore((state) => state.dialogOpen)

  const tabs = useWorkspaceStore((state) => state.tabsByConnection[sessionId] ?? EMPTY_TABS)
  const selectedWorkspaceTabId = useWorkspaceStore(
    (state) => state.activeTabByConnection[sessionId] ?? null
  )

  // While the connection is hidden, no workspace tab is visibly active. This
  // reuses the existing inactive-child cleanup and pause behavior throughout the
  // descendant tree (WorkspaceBody, WorkspaceTabPanel, grids, editors, polling).
  const visibleActiveWorkspaceTabId = isActive ? selectedWorkspaceTabId : null
  const activeTab = tabs.find((t) => t.id === visibleActiveWorkspaceTabId) ?? null

  // Per-session stable panel ordering so retained DOM instances are preserved
  // across reorders independently of any other connection's workspace.
  const [panelOrder, setPanelOrder] = useState<string[]>(() => tabs.map((t) => t.id))
  const [prevTabs, setPrevTabs] = useState(tabs)

  let nextPanelOrder = panelOrder
  if (prevTabs !== tabs) {
    nextPanelOrder = panelOrder.filter((tabId) => tabs.some((tab) => tab.id === tabId))
    const seenIds = new Set(nextPanelOrder)
    for (const tab of tabs) {
      if (!seenIds.has(tab.id)) {
        nextPanelOrder = [...nextPanelOrder, tab.id]
        seenIds.add(tab.id)
      }
    }
    setPanelOrder(nextPanelOrder)
    setPrevTabs(tabs)
  }

  const panelTabs = nextPanelOrder
    .map((tabId) => tabs.find((tab) => tab.id === tabId) ?? null)
    .filter((tab): tab is WorkspaceTab => tab != null)
    .filter(
      (tab) =>
        !(bottomTableTabsEnabled && tab.type === 'table-data' && tab.parentQueryTabId !== undefined)
    )

  if (!activeConnection) {
    return null
  }

  const modifierClass = isActive
    ? styles.connectionWorkspaceActive
    : styles.connectionWorkspaceInactive
  const rootClassName = [styles.connectionWorkspace, modifierClass].join(' ')

  return (
    <div
      className={rootClassName}
      data-testid={isActive ? 'active-connection-workspace' : 'inactive-connection-workspace'}
      data-session-id={sessionId}
      data-active={isActive}
      aria-hidden={isActive ? undefined : true}
      inert={isActive ? undefined : true}
    >
      <WorkspaceTabs
        connectionId={sessionId}
        hideTableDataTabs={bottomTableTabsEnabled}
        connectionActive={isActive}
      />
      <AiDiffBridgeProvider>
        <WorkspaceBody
          tabs={tabs}
          activeTabId={visibleActiveWorkspaceTabId}
          connectionId={sessionId}
          sessionId={sessionId}
          renderTabStack={() => (
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
          )}
        />
      </AiDiffBridgeProvider>
      {isActive && favoriteDialogOpen && <FavoriteDialog connectionId={sessionId} />}
    </div>
  )
}
