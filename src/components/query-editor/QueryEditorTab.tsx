/**
 * Main query editor workspace tab — vertical split layout with
 * editor (top) and results panel placeholder (bottom).
 *
 * When AI is enabled, the editor area is wrapped in a horizontal Group
 * containing the Monaco editor (left) and the AI panel (right, collapsible).
 *
 * Does NOT call evict_results on unmount because tab switching
 * unmounts this component. Eviction is handled by workspace-store.closeTab.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import type { QueryEditorTab as QueryEditorTabType } from '../../types/schema'
import { useQueryStore } from '../../stores/query-store'
import { useAiStore } from '../../stores/ai-store'
import { useSettingsStore } from '../../stores/settings-store'
import { MonacoEditorWrapper } from './MonacoEditorWrapper'
import { EditorToolbar } from './EditorToolbar'
import { ResultPanel } from './ResultPanel'
import { QueryExecutionOverlay } from './QueryExecutionOverlay'
import { DiffOverlay } from './DiffOverlay'
import { AiPanel } from '../ai-panel/AiPanel'
import {
  buildDiffState,
  applyDiff,
  restoreTabAfterDiff,
  DIFF_OVERLAY_INITIAL,
} from './diff-overlay-utils'
import type { DiffOverlayState, PlainRange } from './diff-overlay-utils'
import type * as MonacoType from 'monaco-editor'
import styles from './QueryEditorTab.module.css'

interface QueryEditorTabProps {
  tab: QueryEditorTabType
}

export function QueryEditorTab({ tab }: QueryEditorTabProps) {
  const [diffOverlayState, setDiffOverlayState] = useState<DiffOverlayState>(DIFF_OVERLAY_INITIAL)
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null)

  // AI panel state
  const aiEnabled = useSettingsStore((s) => s.getSetting('ai.enabled') === 'true')
  const isPanelOpen = useAiStore((s) => s.tabs[tab.id]?.isPanelOpen ?? false)
  const aiPanelRef = usePanelRef()

  // Subscribe to tabStatus so we re-render when it changes (used by toolbar and overlay)
  const status = useQueryStore((state) => state.tabs[tab.id]?.tabStatus ?? 'idle')

  // Sync AI panel collapse/expand with store state
  useEffect(() => {
    if (!aiEnabled) return
    if (isPanelOpen) {
      aiPanelRef.current?.expand()
    } else {
      aiPanelRef.current?.collapse()
    }
  }, [isPanelOpen, aiEnabled, aiPanelRef])

  const handleEditorMount = useCallback((editor: MonacoType.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor
  }, [])

  /** Explicitly relayout the Monaco editor when the panel is resized so
   *  overlay widgets (suggest popup, parameter hints) know the new viewport. */
  const handleEditorPanelResize = useCallback(() => {
    editorRef.current?.layout()
  }, [])

  /** Also relayout when the horizontal editor panel resizes (AI panel open/close/drag). */
  const handleHorizontalEditorResize = useCallback(() => {
    editorRef.current?.layout()
  }, [])

  /** Sync store when AI panel is collapsed via the resize handle (dragged below minSize). */
  const handleAiPanelResize = useCallback(() => {
    const collapsed = aiPanelRef.current?.isCollapsed() ?? false
    const storeOpen = useAiStore.getState().tabs[tab.id]?.isPanelOpen ?? false
    if (collapsed && storeOpen) {
      useAiStore.getState().closePanel(tab.id)
    } else if (!collapsed && !storeOpen) {
      useAiStore.getState().openPanel(tab.id)
    }
  }, [tab.id, aiPanelRef])

  /** Open the diff overlay to compare original vs AI-proposed SQL. */
  const handleTriggerDiff = useCallback(
    (proposedSql: string, range: PlainRange) => {
      const result = buildDiffState(editorRef.current, proposedSql, range)
      if (!result) return

      setDiffOverlayState(result)
      useAiStore.getState().setAiReviewing(tab.id)
    },
    [tab.id]
  )

  /** Accept the AI-proposed change — replace the original range in the editor. */
  const handleDiffAccept = useCallback(
    (finalSql: string) => {
      const applied = applyDiff(editorRef.current, diffOverlayState, finalSql, tab.id)
      if (applied) {
        setDiffOverlayState(DIFF_OVERLAY_INITIAL)
        restoreTabAfterDiff(tab.id)
      }
      // If not applied, leave overlay open (error toast already shown)
    },
    [diffOverlayState, tab.id]
  )

  /** Reject the AI diff — dismiss overlay without changes. */
  const handleDiffReject = useCallback(() => {
    setDiffOverlayState(DIFF_OVERLAY_INITIAL)
    restoreTabAfterDiff(tab.id)
  }, [tab.id])

  const editorContent = (
    <MonacoEditorWrapper
      tabId={tab.id}
      connectionId={tab.connectionId}
      onMount={handleEditorMount}
    />
  )

  const editorArea = aiEnabled ? (
    <Group orientation="horizontal" className={styles.horizontalGroup}>
      <Panel
        defaultSize="70%"
        minSize="30%"
        className={styles.editorPanel}
        onResize={handleHorizontalEditorResize}
      >
        {editorContent}
      </Panel>
      <Separator className={styles.horizontalResizeHandle}>
        <div className={styles.horizontalResizePill} />
      </Separator>
      <Panel
        panelRef={aiPanelRef}
        defaultSize="30%"
        minSize="20%"
        maxSize="45%"
        collapsible={true}
        collapsedSize="0%"
        className={styles.aiPanel}
        onResize={handleAiPanelResize}
      >
        <AiPanel tabId={tab.id} connectionId={tab.connectionId} onTriggerDiff={handleTriggerDiff} />
      </Panel>
    </Group>
  ) : (
    <div className={styles.editorPanel}>{editorContent}</div>
  )

  return (
    <div className={styles.container} data-testid="query-editor-tab">
      <EditorToolbar connectionId={tab.connectionId} tabId={tab.id} />
      <div className={styles.contentArea}>
        {status === 'running' && <QueryExecutionOverlay />}
        <Group orientation="vertical" className={styles.panelGroup}>
          <Panel
            defaultSize="60%"
            minSize="20%"
            className={styles.editorPanelOuter}
            onResize={handleEditorPanelResize}
          >
            {editorArea}
            {diffOverlayState.visible && (
              <DiffOverlay
                originalSql={diffOverlayState.originalSql}
                proposedSql={diffOverlayState.proposedSql}
                originalRange={diffOverlayState.originalRange}
                onAccept={handleDiffAccept}
                onReject={handleDiffReject}
              />
            )}
          </Panel>
          <Separator className={styles.resizeHandle}>
            <div className={styles.resizePill} />
          </Separator>
          <Panel defaultSize="40%" minSize="15%" className={styles.resultPanel}>
            <ResultPanel tabId={tab.id} connectionId={tab.connectionId} />
          </Panel>
        </Group>
      </div>
    </div>
  )
}
