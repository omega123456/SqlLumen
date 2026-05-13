import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { dispatchWorkspaceLayoutResize } from '../../lib/workspace-layout-events'
import { useAiStore } from '../../stores/ai-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type { QueryEditorTab, WorkspaceTab } from '../../types/schema'
import { AiPanel } from '../ai-panel/AiPanel'
import { useAiDiffTrigger } from '../query-editor/ai-diff-bridge-context'
import styles from './WorkspaceBody.module.css'

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

export function WorkspaceBody({
  tabs,
  activeTabId,
  connectionId,
  sessionId,
  renderTabStack,
}: WorkspaceBodyProps) {
  const queryTabs = tabs.filter(isQueryEditorTab)
  const activeQueryTab = queryTabs.find((tab) => tab.id === activeTabId) ?? null
  const activeQueryTabId = activeQueryTab?.id ?? null
  const isActiveQueryPanelOpen = useAiStore((state) =>
    activeQueryTabId ? (state.tabs[activeQueryTabId]?.isPanelOpen ?? false) : false
  )
  const aiChatPanelRef = usePanelRef()
  const triggerDiff = useAiDiffTrigger()
  const setLastFocusedSurface = useWorkspaceStore((state) => state.setLastFocusedSurface)

  useEffect(() => {
    if (activeQueryTab && isActiveQueryPanelOpen) {
      aiChatPanelRef.current?.expand()
    } else {
      aiChatPanelRef.current?.collapse()
    }
  }, [activeQueryTab, isActiveQueryPanelOpen, aiChatPanelRef])

  function handleAiChatResize(): void {
    if (activeQueryTabId) {
      const collapsed = aiChatPanelRef.current?.isCollapsed() ?? false
      const storeOpen = useAiStore.getState().tabs[activeQueryTabId]?.isPanelOpen ?? false
      if (collapsed && storeOpen) {
        useAiStore.getState().closePanel(activeQueryTabId)
      } else if (!collapsed && !storeOpen) {
        useAiStore.getState().openPanel(activeQueryTabId)
      }
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
        <Separator className={styles.separator} />
        <Panel
          panelRef={aiChatPanelRef}
          defaultSize="25%"
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
                aria-hidden={!isActive}
                data-testid="workspace-ai-panel-host"
                data-tab-id={tab.id}
                onFocusCapture={() => setLastFocusedSurface(tab.id, 'ai-input')}
              >
                <AiPanel
                  tabId={tab.id}
                  connectionId={tab.connectionId}
                  onTriggerDiff={(sql, range) => {
                    triggerDiff(tab.id, sql, range)
                  }}
                />
              </div>
            )
          })}
        </Panel>
      </Group>
    </div>
  )
}
