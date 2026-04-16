import { useCallback, useEffect, type ReactNode } from 'react'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import type { QueryEditorTab as QueryEditorTabType } from '../../types/schema'
import { useAiStore } from '../../stores/ai-store'
import { useAiDiffTrigger } from '../query-editor/ai-diff-bridge-context'
import { AiPanel } from '../ai-panel/AiPanel'
import { QueryWorkspaceAiRail } from '../ai-panel/QueryWorkspaceAiRail'
import { WORKSPACE_LAYOUT_EVENT } from '../../lib/workspace-layout-events'
import areaStyles from './WorkspaceArea.module.css'
import styles from './WorkspaceAiResizableRow.module.css'

export function dispatchWorkspaceMainLayout(): void {
  window.dispatchEvent(new CustomEvent(WORKSPACE_LAYOUT_EVENT))
}

export interface WorkspaceAiResizableRowProps {
  tab: QueryEditorTabType
  children: ReactNode
}

/**
 * Workspace body when AI is enabled on a query tab: horizontal split
 * (scroll / AI chat) with a drag handle, plus a fixed icon rail on the far right.
 */
export function WorkspaceAiResizableRow({ tab, children }: WorkspaceAiResizableRowProps) {
  const isPanelOpen = useAiStore((s) => s.tabs[tab.id]?.isPanelOpen ?? false)
  const aiChatPanelRef = usePanelRef()
  const triggerDiff = useAiDiffTrigger()

  useEffect(() => {
    if (isPanelOpen) {
      aiChatPanelRef.current?.expand()
    } else {
      aiChatPanelRef.current?.collapse()
    }
  }, [isPanelOpen, aiChatPanelRef])

  const handleAiChatResize = useCallback(() => {
    const collapsed = aiChatPanelRef.current?.isCollapsed() ?? false
    const storeOpen = useAiStore.getState().tabs[tab.id]?.isPanelOpen ?? false
    if (collapsed && storeOpen) {
      useAiStore.getState().closePanel(tab.id)
    } else if (!collapsed && !storeOpen) {
      useAiStore.getState().openPanel(tab.id)
    }
    dispatchWorkspaceMainLayout()
  }, [tab.id, aiChatPanelRef])

  const handleWorkspacePanelResize = useCallback(() => {
    dispatchWorkspaceMainLayout()
  }, [])

  return (
    <div className={styles.workspaceMain}>
      <Group orientation="horizontal" className={styles.resizeGroup}>
        <Panel
          defaultSize="75%"
          minSize="35%"
          className={styles.workspaceScrollPanel}
          onResize={handleWorkspacePanelResize}
        >
          <div className={areaStyles.workspaceScroll}>
            <div className={areaStyles.tabContent}>{children}</div>
          </div>
        </Panel>
        <Separator className={styles.resizeHandle}>
          <div className={styles.resizePill} />
        </Separator>
        <Panel
          panelRef={aiChatPanelRef}
          defaultSize="25%"
          minSize="15%"
          maxSize="48%"
          collapsible={true}
          collapsedSize="0%"
          className={styles.aiChatPanelHost}
          onResize={handleAiChatResize}
        >
          {isPanelOpen && (
            <AiPanel
              tabId={tab.id}
              connectionId={tab.connectionId}
              onTriggerDiff={(sql, range) => {
                triggerDiff(tab.id, sql, range)
              }}
            />
          )}
        </Panel>
      </Group>
      <QueryWorkspaceAiRail tab={tab} />
    </div>
  )
}
