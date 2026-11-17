import { ClipboardText, CopySimple, FastForward } from '@phosphor-icons/react'
import { useQueryStore } from '../../stores/query-store'
import { useConnectionStore } from '../../stores/connection-store'
import { SplitButton } from '../common/SplitButton'
import type { TabContextMenuItem } from '../shared/TabContextMenu'
import { RunningIndicator } from './RunningIndicator'
import { isAiLockStatus } from '../../lib/query-tab-status'
import { useEditorToolbarActions } from './editor-toolbar/use-editor-toolbar-actions'
import { EditorFileActions } from './editor-toolbar/EditorFileActions'
import { useShortcutStore } from '../../stores/shortcut-store'
import { menuShortcutLabel } from '../../lib/shortcut-labels'

const EXECUTE_ALL_COPY_PATH_ACTION = 'execute-all-copy-path'

type EditorToolbarActions = ReturnType<typeof useEditorToolbarActions>

function runMenuItems(
  actions: EditorToolbarActions,
  shortcutLabel: string | undefined
): TabContextMenuItem[] {
  return [
    {
      key: 'execute-all-copy-path',
      label: 'Execute all and copy result path',
      icon: <ClipboardText size={18} weight="regular" />,
      shortcut: shortcutLabel,
      onSelect: actions.handleExecuteAllAndCopyPath,
    },
    {
      key: 'copy-last-run-path',
      label: 'Copy last run file path',
      icon: <CopySimple size={18} weight="regular" />,
      disabled: !actions.hasLastRunFilePath,
      onSelect: actions.handleCopyLastRunPath,
    },
  ]
}

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
  const copyPathBinding = useShortcutStore((state) => state.shortcuts[EXECUTE_ALL_COPY_PATH_ACTION])
  const copyPathShortcutLabel = menuShortcutLabel(copyPathBinding)
  const actions = useEditorToolbarActions({
    connectionId: connectionId,
    tabId: tabId,
    content: content,
    isDisabled: isDisabled,
  })

  return (
    <div
      className="flex h-command-bar shrink-0 items-center justify-between gap-2 border-b border-b-light-stroke-divider bg-light-surface-container px-2 dark:border-b-dark-stroke-divider dark:bg-dark-surface-container"
      data-testid="editor-toolbar"
    >
      <EditorFileActions actions={actions} isDisabled={isDisabled} isReadOnly={isReadOnly} />

      <div className="flex items-center gap-2">
        {isRunning ? (
          <RunningIndicator connectionId={connectionId} tabId={tabId} />
        ) : (
          <SplitButton
            onClick={actions.handleExecuteAll}
            disabled={!content.trim()}
            menuLabel="More run options"
            menuItems={runMenuItems(actions, copyPathShortcutLabel)}
            testId="toolbar-execute-all"
          >
            <FastForward size={16} weight="regular" />
            <span>Execute all</span>
          </SplitButton>
        )}
      </div>
    </div>
  )
}
