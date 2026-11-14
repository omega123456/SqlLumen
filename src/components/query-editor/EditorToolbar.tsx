import { FastForward } from '@phosphor-icons/react'
import { useQueryStore } from '../../stores/query-store'
import { useConnectionStore } from '../../stores/connection-store'
import { Button } from '../common/Button'
import { RunningIndicator } from './RunningIndicator'
import styles from './EditorToolbar.module.css'
import { isAiLockStatus } from '../../lib/query-tab-status'
import { useEditorToolbarActions } from './editor-toolbar/use-editor-toolbar-actions'
import { EditorFileActions } from './editor-toolbar/EditorFileActions'

interface EditorToolbarProps {
  connectionId: string
  tabId: string
}

export function EditorToolbar({ connectionId, tabId }: EditorToolbarProps) {
  const content = useQueryStore((state) => state.tabs[tabId]?.content ?? '')
  const status = useQueryStore((state) => state.tabs[tabId]?.tabStatus ?? 'idle')
  const isReadOnly =
    useConnectionStore((state) => state.activeConnections[connectionId]?.profile?.readOnly) ?? false

  const isRunning = status === 'running'
  const isDisabled = isRunning || isAiLockStatus(status)
  const actions = useEditorToolbarActions({
    connectionId: connectionId,
    tabId: tabId,
    content: content,
    isDisabled: isDisabled,
  })

  return (
    <div className={styles.toolbar} data-testid="editor-toolbar">
      <EditorFileActions actions={actions} isDisabled={isDisabled} isReadOnly={isReadOnly} />

      <div className={styles.rightActions}>
        {isRunning ? (
          <RunningIndicator connectionId={connectionId} tabId={tabId} />
        ) : (
          <Button
            variant="accent"
            onClick={actions.handleExecuteAll}
            disabled={!content.trim()}
            data-testid="toolbar-execute-all"
          >
            <FastForward size={16} weight="regular" />
            <span>Execute all</span>
          </Button>
        )}
      </div>
    </div>
  )
}
