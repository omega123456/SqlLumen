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
import { RETAINED_HIDDEN_STYLE } from '../../lib/retained-hidden-style'

const EMPTY_TABS: WorkspaceTab[] = []
const CONNECTED_PLACEHOLDER_CLASS_NAME =
  'absolute top-1/2 left-1/2 flex max-w-120 -translate-1/2 flex-col items-center gap-3 p-8 text-center'
const CONNECTED_TEXT_CLASS_NAME =
  'wrap-break-word text-size-body font-regular text-light-on-surface dark:text-dark-on-surface'

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
      className: 'relative flex h-full min-h-0 flex-col',
      'data-testid': 'active-connection-workspace',
      'aria-hidden': undefined,
      inert: undefined,
    }
  }
  return {
    className: 'pointer-events-none absolute inset-0 flex min-h-0 flex-col aria-hidden:invisible',
    style: RETAINED_HIDDEN_STYLE,
    'data-testid': 'inactive-connection-workspace',
    'data-animation-paused': true,
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
    <div className="relative h-full min-h-0 flex-1 overflow-hidden">
      {tabs.length === 0 && (
        <div className={CONNECTED_PLACEHOLDER_CLASS_NAME}>
          <p className={CONNECTED_TEXT_CLASS_NAME}>
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
        <div className={CONNECTED_PLACEHOLDER_CLASS_NAME}>
          <p className={CONNECTED_TEXT_CLASS_NAME}>Select a tab to view content</p>
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
