import { useEffect, lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import {
  Group,
  Panel,
  Separator,
  usePanelRef,
  type PanelImperativeHandle,
} from 'react-resizable-panels'
import { dispatchWorkspaceLayoutResize } from '../../lib/workspace-layout-events'
import { useAiStore } from '../../stores/ai-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type { QueryEditorTab, WorkspaceTab } from '../../types/schema'
import AiPanelSkeleton from '../skeletons/AiPanelSkeleton'
import { QueryWorkspaceAiRail } from '../ai-panel/QueryWorkspaceAiRail'
import { useAiDiffTrigger } from '../query-editor/ai-diff-bridge-context'
import styles from './WorkspaceBody.module.css'

const LazyAiPanel = lazy(() => import('../ai-panel/AiPanel'))

/** Width the AI panel opens at (prototype `.p-ai.open`). */
const AI_PANEL_OPEN_WIDTH_PX = 340

export interface WorkspaceBodyProps {
  tabs: WorkspaceTab[]
  activeTabId: string | null
  connectionId: string
  sessionId?: string
  renderTabStack: (props: {
    tabs: WorkspaceTab[]
    activeTabId: string | null
    connectionId: string
    sessionId?: string
  }) => ReactNode
}

function isQueryEditorTab(tab: WorkspaceTab): tab is QueryEditorTab {
  return tab.type === 'query-editor'
}

const AI_PANEL_EXPANDED_DEFAULT_SIZE = '25%'
const AI_PANEL_COLLAPSED_SIZE = '0%'

function aiPanelDefaultSizeFor(shouldExpand: boolean): string {
  if (shouldExpand) return AI_PANEL_EXPANDED_DEFAULT_SIZE
  return AI_PANEL_COLLAPSED_SIZE
}

function findActiveQueryTab(
  queryTabs: QueryEditorTab[],
  activeTabId: string | null
): QueryEditorTab | null {
  return queryTabs.find((tab) => tab.id === activeTabId) ?? null
}

function expandAiPanel(panel: PanelImperativeHandle | null): void {
  if (!panel) return
  panel.expand()
  // A panel that starts collapsed expands to its 15% minimum; open it at the
  // prototype's 340px instead (`.p-ai.open`), within the 48% maximum.
  if (panel.getSize().inPixels < AI_PANEL_OPEN_WIDTH_PX) {
    panel.resize(`${AI_PANEL_OPEN_WIDTH_PX}px`)
  }
}

function syncAiPanelOpenState(tabId: string, collapsed: boolean): void {
  const aiState = useAiStore.getState()
  const storeOpen = aiState.tabs[tabId]?.isPanelOpen ?? false
  if (collapsed && storeOpen) {
    aiState.closePanel(tabId)
    return
  }
  if (!collapsed && !storeOpen) {
    aiState.openPanel(tabId)
  }
}

export function WorkspaceBody({
  tabs,
  activeTabId,
  connectionId,
  sessionId,
  renderTabStack,
}: WorkspaceBodyProps) {
  const queryTabs = tabs.filter(isQueryEditorTab)
  const activeQueryTab = findActiveQueryTab(queryTabs, activeTabId)
  const activeQueryTabId = activeQueryTab?.id ?? null
  const isActiveQueryPanelOpen = useAiStore((state) =>
    activeQueryTabId ? (state.tabs[activeQueryTabId]?.isPanelOpen ?? false) : false
  )
  const aiChatPanelRef = usePanelRef()
  const triggerDiff = useAiDiffTrigger()
  const setLastFocusedSurface = useWorkspaceStore((state) => state.setLastFocusedSurface)
  const aiEnabled = useSettingsStore(
    (state) =>
      (state.pendingChanges['ai.enabled'] ?? state.settings['ai.enabled'] ?? 'false') === 'true'
  )
  const hasQueryTabs = queryTabs.length > 0
  const showActiveQueryAiLayout = aiEnabled && activeQueryTab != null
  const shouldRenderAiPanelStack = aiEnabled && hasQueryTabs
  const shouldExpandAiPanel = activeQueryTabId != null && isActiveQueryPanelOpen
  const aiPanelDefaultSize = aiPanelDefaultSizeFor(shouldExpandAiPanel)

  useEffect(() => {
    if (!shouldExpandAiPanel) {
      aiChatPanelRef.current?.collapse()
      return
    }
    expandAiPanel(aiChatPanelRef.current)
  }, [aiChatPanelRef, shouldExpandAiPanel])

  function handleAiChatResize(): void {
    if (activeQueryTabId) {
      syncAiPanelOpenState(activeQueryTabId, aiChatPanelRef.current?.isCollapsed() ?? false)
    }
    dispatchWorkspaceLayoutResize()
  }

  function handleWorkspacePanelResize(): void {
    dispatchWorkspaceLayoutResize()
  }

  return (
    <div className={styles.body} data-testid="workspace-body">
      <Group orientation="horizontal" className={styles.body}>
        <Panel
          defaultSize="75%"
          minSize="35%"
          className={styles.tabStack}
          onResize={handleWorkspacePanelResize}
        >
          {renderTabStack({ tabs, activeTabId, connectionId, sessionId })}
        </Panel>
        {showActiveQueryAiLayout ? <QueryWorkspaceAiRail tab={activeQueryTab} /> : null}
        {showActiveQueryAiLayout ? <Separator className={styles.separator} /> : null}
        {shouldRenderAiPanelStack ? (
          <Panel
            panelRef={aiChatPanelRef}
            defaultSize={aiPanelDefaultSize}
            minSize="15%"
            maxSize="48%"
            collapsible={true}
            collapsedSize="0%"
            className={styles.aiSide}
            onResize={handleAiChatResize}
          >
            {queryTabs.map((tab) => {
              const isActive = tab.id === activeQueryTabId
              return (
                <div
                  key={tab.id}
                  className={styles.aiPanelHost}
                  style={isActive ? undefined : { visibility: 'hidden', pointerEvents: 'none' }}
                  aria-hidden={isActive ? undefined : true}
                  data-testid="workspace-ai-panel-host"
                  data-tab-id={tab.id}
                  onFocusCapture={() => setLastFocusedSurface(tab.id, 'ai-input')}
                >
                  <Suspense fallback={<AiPanelSkeleton />}>
                    <LazyAiPanel
                      tabId={tab.id}
                      connectionId={tab.connectionId}
                      onTriggerDiff={(sql, range) => {
                        triggerDiff(tab.id, sql, range)
                      }}
                    />
                  </Suspense>
                </div>
              )
            })}
          </Panel>
        ) : null}
      </Group>
    </div>
  )
}
