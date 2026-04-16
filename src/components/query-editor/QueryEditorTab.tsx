/**
 * Main query editor workspace tab — vertical split layout with
 * editor (top) and results panel (bottom).
 *
 * The AI assistant chat lives in `WorkspaceAiResizableRow` (resizable split
 * on the right of the workspace), not in this component.
 *
 * Does NOT call evict_results on unmount because tab switching
 * unmounts this component. Eviction is handled by workspace-store.closeTab.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { QueryEditorTab as QueryEditorTabType } from '../../types/schema'
import { useQueryStore } from '../../stores/query-store'
import { useAiStore } from '../../stores/ai-store'
import { MonacoEditorWrapper } from './MonacoEditorWrapper'
import { EditorToolbar } from './EditorToolbar'
import { ResultPanel } from './ResultPanel'
import { QueryExecutionOverlay } from './QueryExecutionOverlay'
import { DiffOverlay } from './DiffOverlay'
import { useRegisterAiDiffHandler } from './ai-diff-bridge-context'
import { WORKSPACE_LAYOUT_EVENT } from '../../lib/workspace-layout-events'
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

  const status = useQueryStore((state) => state.tabs[tab.id]?.tabStatus ?? 'idle')

  const handleEditorMount = useCallback((editor: MonacoType.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor
  }, [])

  /** Explicitly relayout the Monaco editor when the panel is resized so
   *  overlay widgets (suggest popup, parameter hints) know the new viewport. */
  const handleEditorPanelResize = useCallback(() => {
    editorRef.current?.layout()
  }, [])

  /** Open the diff overlay to compare original vs AI-proposed SQL. */
  const handleTriggerDiff = useCallback(
    (proposedSql: string, range: PlainRange) => {
      const result = buildDiffState(editorRef.current, proposedSql, range)
      if (!result) {
        return
      }

      setDiffOverlayState(result)
      useAiStore.getState().setAiReviewing(tab.id)
    },
    [tab.id]
  )

  useRegisterAiDiffHandler(tab.id, handleTriggerDiff)

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

  /** When the workspace AI chat opens/closes or the split is dragged, relayout Monaco. */
  const isPanelOpen = useAiStore((s) => s.tabs[tab.id]?.isPanelOpen ?? false)
  useEffect(() => {
    editorRef.current?.layout()
  }, [isPanelOpen])

  useEffect(() => {
    const onWorkspaceResize = () => {
      editorRef.current?.layout()
    }
    window.addEventListener(WORKSPACE_LAYOUT_EVENT, onWorkspaceResize)
    return () => {
      window.removeEventListener(WORKSPACE_LAYOUT_EVENT, onWorkspaceResize)
    }
  }, [])

  const editorContent = (
    <MonacoEditorWrapper
      tabId={tab.id}
      connectionId={tab.connectionId}
      onMount={handleEditorMount}
    />
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
            <div className={styles.editorPanel}>{editorContent}</div>
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
