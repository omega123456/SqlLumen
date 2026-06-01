/**
 * Main query editor workspace tab — vertical split layout with
 * editor (top) and results panel (bottom).
 *
 * The AI assistant chat lives in `WorkspaceBody` (resizable split
 * on the right of the workspace), not in this component.
 *
 * Does NOT call evict_results on unmount. The workspace subtree is retained
 * while switching between workspace tabs and between connection sessions, so
 * this component is not unmounted on those transitions. Row-payload eviction is
 * owned by the stores (workspace-store.closeTab and the result/table-data TTL
 * lifecycle), not by this component's unmount.
 */

import { useState, useCallback, useRef, useEffect, lazy, Suspense } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { QueryEditorTab as QueryEditorTabType } from '../../types/schema'
import { useQueryStore } from '../../stores/query-store'
import { useAiStore } from '../../stores/ai-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../stores/settings-store'
import MonacoEditorSkeleton from '../skeletons/MonacoEditorSkeleton'
import { EditorToolbar } from './EditorToolbar'
import { BottomPanelTabs } from './BottomPanelTabs'
import { QueryBottomPanel } from './QueryBottomPanel'
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

const LazyMonacoEditorWrapper = lazy(() => import('./MonacoEditorWrapper'))

interface QueryEditorTabProps {
  tab: QueryEditorTabType
  isActive?: boolean
}

export function QueryEditorTab({ tab, isActive = true }: QueryEditorTabProps) {
  const [diffOverlayState, setDiffOverlayState] = useState<DiffOverlayState>(DIFF_OVERLAY_INITIAL)
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null)
  const wasActiveRef = useRef(isActive)

  const status = useQueryStore((state) => state.tabs[tab.id]?.tabStatus ?? 'idle')
  const bottomTableTabsEnabled = useSettingsStore(
    (state) =>
      (state.settings['results.tableTabsInBottomPanel'] ??
        SETTINGS_DEFAULTS['results.tableTabsInBottomPanel']) === 'true'
  )

  const setLastFocusedSurface = useWorkspaceStore((state) => state.setLastFocusedSurface)
  const lastFocusedSurface = useWorkspaceStore((state) => state.lastFocusedSurfaceByTab[tab.id])

  const handleEditorMount = useCallback(
    (editor: MonacoType.editor.IStandaloneCodeEditor) => {
      editorRef.current = editor
      editor.onDidFocusEditorWidget?.(() => setLastFocusedSurface(tab.id, 'editor'))
      if (isActive) {
        editor.focus()
      }
    },
    [isActive, setLastFocusedSurface, tab.id]
  )

  /** Explicitly relayout the Monaco editor when the panel is resized so
   *  overlay widgets (suggest popup, parameter hints) know the new viewport. */
  const handleEditorPanelResize = useCallback(() => {
    if (!isActive) return
    editorRef.current?.layout()
  }, [isActive])

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
    if (!isActive) return
    editorRef.current?.layout()
  }, [isActive, isPanelOpen])

  useEffect(() => {
    if (!isActive) {
      wasActiveRef.current = false
      return
    }
    if (wasActiveRef.current) return
    wasActiveRef.current = true

    if (lastFocusedSurface === 'ai-input') {
      const host = document.querySelector<HTMLElement>(
        `[data-testid="workspace-ai-panel-host"][data-tab-id="${tab.id}"]`
      )
      host?.querySelector<HTMLElement>('[data-testid="ai-chat-textarea"]')?.focus()
      return
    }
    editorRef.current?.focus()
  }, [isActive, lastFocusedSurface, tab.id])

  useEffect(() => {
    const onWorkspaceResize = () => {
      if (!isActive) return
      editorRef.current?.layout()
    }
    window.addEventListener(WORKSPACE_LAYOUT_EVENT, onWorkspaceResize)
    return () => {
      window.removeEventListener(WORKSPACE_LAYOUT_EVENT, onWorkspaceResize)
    }
  }, [isActive])

  const editorContent = (
    <Suspense fallback={<MonacoEditorSkeleton />}>
      <LazyMonacoEditorWrapper
        tabId={tab.id}
        connectionId={tab.connectionId}
        onMount={handleEditorMount}
      />
    </Suspense>
  )

  return (
    <div className={styles.container} data-testid="query-editor-tab">
      <EditorToolbar connectionId={tab.connectionId} tabId={tab.id} />
      <div className={styles.contentArea}>
        {(status === 'running' || status === 'restoring') && <QueryExecutionOverlay />}
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
            {bottomTableTabsEnabled ? (
              <>
                <BottomPanelTabs queryTabId={tab.id} connectionId={tab.connectionId} />
                <QueryBottomPanel
                  queryTabId={tab.id}
                  connectionId={tab.connectionId}
                  isActive={isActive}
                />
              </>
            ) : (
              <ResultPanel tabId={tab.id} connectionId={tab.connectionId} isActive={isActive} />
            )}
          </Panel>
        </Group>
      </div>
    </div>
  )
}
