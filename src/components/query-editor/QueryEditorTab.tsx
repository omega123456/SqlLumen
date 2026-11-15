import { useRef, lazy, Suspense } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { QueryEditorTab as QueryEditorTabType } from '../../types/schema'
import { useQueryStore } from '../../stores/query-store'
import { useBottomTableTabsEnabled } from '../../stores/settings-store'
import MonacoEditorSkeleton from '../skeletons/MonacoEditorSkeleton'
import { EditorToolbar } from './EditorToolbar'
import { BottomPanelTabs } from './BottomPanelTabs'
import { QueryBottomPanel } from './QueryBottomPanel'
import { ResultPanel } from './ResultPanel'
import { QueryExecutionOverlay } from './QueryExecutionOverlay'
import { DiffOverlay } from './DiffOverlay'
import { useAiDiffOverlay } from './query-editor-tab/use-ai-diff-overlay'
import { useEditorLayoutSync } from './query-editor-tab/use-editor-layout-sync'
import type * as MonacoType from 'monaco-editor'
import { joinClassNames } from '../../lib/class-names'
import { FOCUS_RING } from '../../lib/focus-ring'

const LazyMonacoEditorWrapper = lazy(() => import('./MonacoEditorWrapper'))

interface QueryEditorTabProps {
  tab: QueryEditorTabType
  isActive?: boolean
}

function EditorResultSeparator() {
  return (
    <Separator
      className={joinClassNames([
        'group/resize-handle flex h-1.5 shrink-0 cursor-row-resize items-center justify-center bg-light-surface-container-low transition-bg duration-150 hover:bg-light-fill-subtle-hover resize-dragging:bg-light-fill-subtle-hover dark:bg-dark-surface-container-low dark:hover:bg-dark-fill-subtle-hover dark:resize-dragging:bg-dark-fill-subtle-hover',
        FOCUS_RING,
      ])}
    >
      <div className="h-0.75 w-8 rounded-track bg-light-outline-variant transition-bg duration-150 group-hover/resize-handle:bg-light-primary group-resize-dragging/resize-handle:bg-light-primary dark:bg-dark-outline-variant dark:group-hover/resize-handle:bg-dark-primary dark:group-resize-dragging/resize-handle:bg-dark-primary" />
    </Separator>
  )
}

function QueryResultArea({ tab, isActive }: { tab: QueryEditorTabType; isActive: boolean }) {
  const bottomTableTabsEnabled = useBottomTableTabsEnabled()
  if (!bottomTableTabsEnabled) {
    return <ResultPanel tabId={tab.id} connectionId={tab.connectionId} isActive={isActive} />
  }
  return (
    <>
      <BottomPanelTabs queryTabId={tab.id} connectionId={tab.connectionId} />
      <QueryBottomPanel queryTabId={tab.id} connectionId={tab.connectionId} isActive={isActive} />
    </>
  )
}

export function QueryEditorTab({ tab, isActive = true }: QueryEditorTabProps) {
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null)
  const status = useQueryStore((state) => state.tabs[tab.id]?.tabStatus ?? 'idle')
  const { handleEditorMount, handleEditorPanelResize } = useEditorLayoutSync({
    tabId: tab.id,
    isActive: isActive,
    editorRef: editorRef,
  })
  const { diffOverlayState, handleDiffAccept, handleDiffReject } = useAiDiffOverlay(
    tab.id,
    editorRef
  )
  const showsExecutionOverlay = status === 'running' || status === 'restoring'

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
    <div className="flex h-full w-full flex-col overflow-hidden" data-testid="query-editor-tab">
      <EditorToolbar connectionId={tab.connectionId} tabId={tab.id} />
      <div className="relative flex min-h-0 flex-1 flex-col">
        {showsExecutionOverlay && <QueryExecutionOverlay />}
        <Group orientation="vertical" className="min-h-0 flex-1">
          <Panel
            defaultSize="60%"
            minSize="20%"
            className="relative overflow-hidden"
            onResize={handleEditorPanelResize}
          >
            <div className="h-full overflow-hidden">{editorContent}</div>
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
          <EditorResultSeparator />
          <Panel
            defaultSize="40%"
            minSize="15%"
            className="flex flex-col overflow-hidden bg-light-surface-container-low dark:bg-dark-surface-container-low"
          >
            <QueryResultArea tab={tab} isActive={isActive} />
          </Panel>
        </Group>
      </div>
    </div>
  )
}
