import { useCallback, useRef } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import type * as MonacoType from 'monaco-editor'
import { useQueryStore } from '../../stores/query-store'
import { useShortcutStore } from '../../stores/shortcut-store'
import type { TabType } from '../../types/schema'
import './mysql-language-setup'
import './signature-help-provider'
import './codelens-provider'
import { isAiLockStatus, isEditorLockStatus } from '../../lib/query-tab-status'
import { joinClassNames, PRIMARY_RING_SPINNER } from '../../lib/class-names'
import { useEditorMountHandler } from './monaco-editor-wrapper/use-editor-mount'
import { useEditorOptions } from './monaco-editor-wrapper/use-editor-options'
import { useModelConnection } from './monaco-editor-wrapper/use-model-connection'
import { useMonacoTheme } from './monaco-editor-wrapper/use-monaco-theme'
import { useSemanticHighlightingStatus } from './monaco-editor-wrapper/use-semantic-highlighting-status'
import {
  shortcutSignatureOf,
  type MonacoShortcutBindings,
} from './monaco-editor-wrapper/monaco-keybindings'

interface MonacoEditorWrapperProps {
  tabId: string
  connectionId?: string
  tabType?: TabType
  onMount?: (editor: MonacoType.editor.IStandaloneCodeEditor) => void
  value?: string
  onChange?: (value: string) => void
  readOnly?: boolean
}

function useMonacoShortcutBindings(): MonacoShortcutBindings {
  const executeQueryShortcut = useShortcutStore((state) => state.shortcuts['execute-query'])
  const formatQueryShortcut = useShortcutStore((state) => state.shortcuts['format-query'])
  const newQueryTabShortcut = useShortcutStore((state) => state.shortcuts['new-query-tab'])
  return {
    'execute-query': executeQueryShortcut,
    'format-query': formatQueryShortcut,
    'new-query-tab': newQueryTabShortcut,
  }
}

function useEditorChangeHandler(tabId: string, overrideOnChange?: (value: string) => void) {
  const setContent = useQueryStore((state) => state.setContent)
  return useCallback(
    (value: string | undefined) => {
      const editorValue = value ?? ''
      if (overrideOnChange) {
        overrideOnChange(editorValue)
        return
      }
      setContent(tabId, editorValue)
    },
    [overrideOnChange, setContent, tabId]
  )
}

function AiPendingOverlay() {
  return (
    <div
      className="pointer-events-auto absolute inset-0 z-10 flex animate-fade-in-delayed items-center justify-center bg-light-smoke opacity-0 window-blurred:animate-fade-in-delayed-paused dark:bg-dark-smoke"
      data-testid="ai-pending-overlay"
      role="status"
      aria-label="Waiting for AI"
    >
      <div className="flex items-center gap-2 rounded-control border border-light-stroke-card bg-light-surface-container-high px-3 py-2 dark:border-dark-stroke-card dark:bg-dark-surface-container-high">
        <span className={joinClassNames([PRIMARY_RING_SPINNER, 'size-4'])} aria-hidden="true" />
        <span className="font-mono text-size-caption font-semibold whitespace-nowrap text-light-on-surface-variant dark:text-dark-on-surface-variant">
          Waiting for AI…
        </span>
      </div>
    </div>
  )
}

export function MonacoEditorWrapper({
  tabId,
  connectionId,
  tabType = 'query-editor',
  onMount,
  value: overrideValue,
  onChange: overrideOnChange,
  readOnly: overrideReadOnly,
}: MonacoEditorWrapperProps) {
  const monaco = useMonaco()
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null)
  const content = useQueryStore((state) => state.tabs[tabId]?.content ?? '')
  const status = useQueryStore((state) => state.tabs[tabId]?.tabStatus ?? 'idle')
  const isOverrideMode = overrideValue !== undefined
  const isReadOnly = overrideReadOnly ?? isEditorLockStatus(status)
  const isAiLocked = overrideReadOnly === undefined && isAiLockStatus(status)
  const { currentThemeName, applyThemeOnMount } = useMonacoTheme(monaco)
  const modelConnection = useModelConnection(
    { connectionId: connectionId, tabId: tabId, tabType: tabType },
    editorRef
  )
  const { isSemanticHighlightingReady, captureSemanticHighlightingEditor } =
    useSemanticHighlightingStatus()
  const shortcutBindings = useMonacoShortcutBindings()
  const editorOptions = useEditorOptions(isReadOnly)
  const handleChange = useEditorChangeHandler(tabId, overrideOnChange)
  const handleEditorMount = useEditorMountHandler({
    ...modelConnection,
    tabId: tabId,
    connectionId: connectionId,
    isOverrideMode: isOverrideMode,
    editorRef: editorRef,
    shortcutBindings: shortcutBindings,
    applyThemeOnMount: applyThemeOnMount,
    captureSemanticHighlightingEditor: captureSemanticHighlightingEditor,
    onMount: onMount,
  })

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      data-testid="monaco-editor-wrapper"
      data-semantic-highlighting={isSemanticHighlightingReady ? 'ready' : 'pending'}
    >
      <Editor
        key={shortcutSignatureOf(shortcutBindings)}
        height="100%"
        language="mysql"
        theme={currentThemeName}
        value={isOverrideMode ? overrideValue : content}
        onChange={handleChange}
        onMount={handleEditorMount}
        options={editorOptions}
      />
      {isAiLocked && <AiPendingOverlay />}
    </div>
  )
}

export default MonacoEditorWrapper
