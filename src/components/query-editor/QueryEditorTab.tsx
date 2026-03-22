/**
 * Main query editor workspace tab — vertical split layout with
 * editor (top) and results panel placeholder (bottom).
 *
 * Does NOT call evict_results on unmount because tab switching
 * unmounts this component. Eviction is handled by workspace-store.closeTab.
 */

import { useState, useCallback, useRef } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { QueryEditorTab as QueryEditorTabType } from '../../types/schema'
import { useQueryStore } from '../../stores/query-store'
import { MonacoEditorWrapper } from './MonacoEditorWrapper'
import { EditorToolbar } from './EditorToolbar'
import { ResultPanel } from './ResultPanel'
import type * as MonacoType from 'monaco-editor'
import styles from './QueryEditorTab.module.css'

interface QueryEditorTabProps {
  tab: QueryEditorTabType
}

export function QueryEditorTab({ tab }: QueryEditorTabProps) {
  const [cursorLine, setCursorLine] = useState(1)
  const [cursorColumn, setCursorColumn] = useState(1)
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null)

  // Subscribe to status so we re-render when it changes (used indirectly by toolbar)
  useQueryStore((state) => state.tabs[tab.id]?.status ?? 'idle')

  const handleEditorMount = useCallback((editor: MonacoType.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor
    editor.onDidChangeCursorPosition((e) => {
      setCursorLine(e.position.lineNumber)
      setCursorColumn(e.position.column)
    })
  }, [])

  return (
    <div className={styles.container} data-testid="query-editor-tab">
      <EditorToolbar
        connectionId={tab.connectionId}
        tabId={tab.id}
        cursorLine={cursorLine}
        cursorColumn={cursorColumn}
      />
      <Group orientation="vertical" className={styles.panelGroup}>
        <Panel defaultSize="60%" minSize="20%" className={styles.editorPanel}>
          <MonacoEditorWrapper
            tabId={tab.id}
            connectionId={tab.connectionId}
            onMount={handleEditorMount}
          />
        </Panel>
        <Separator className={styles.resizeHandle}>
          <div className={styles.resizePill} />
        </Separator>
        <Panel defaultSize="40%" minSize="15%" className={styles.resultPanel}>
          <ResultPanel tabId={tab.id} connectionId={tab.connectionId} />
        </Panel>
      </Group>
    </div>
  )
}
