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
import styles from './QueryEditorTab.module.css'

const LazyMonacoEditorWrapper = lazy(() => import('./MonacoEditorWrapper'))

interface QueryEditorTabProps {
  tab: QueryEditorTabType
  isActive?: boolean
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
    <div className={styles.container} data-testid="query-editor-tab">
      <EditorToolbar connectionId={tab.connectionId} tabId={tab.id} />
      <div className={styles.contentArea}>
        {showsExecutionOverlay && <QueryExecutionOverlay />}
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
            <QueryResultArea tab={tab} isActive={isActive} />
          </Panel>
        </Group>
      </div>
    </div>
  )
}
