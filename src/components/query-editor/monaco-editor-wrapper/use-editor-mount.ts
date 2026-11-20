import type { RefObject } from 'react'
import type * as MonacoType from 'monaco-editor'
import { useQueryStore } from '../../../stores/query-store'
import {
  bindQueryStoreEditorEvents,
  restoreCursorPosition,
  syncAttachedContextToEditor,
  type StandaloneEditor,
} from './editor-store-bindings'
import { bindCaretOccurrenceHighlight } from './caret-occurrence-highlight'
import {
  addFindReplaceAction,
  registerShortcutCommands,
  type MonacoShortcutBindings,
} from './monaco-keybindings'

export interface EditorMountInputs {
  tabId: string
  connectionId: string | undefined
  isOverrideMode: boolean
  editorRef: RefObject<StandaloneEditor | null>
  shortcutBindings: MonacoShortcutBindings
  captureModelOnMount: (editor: StandaloneEditor) => void
  releaseModelOnDispose: () => void
  applyThemeOnMount: (monacoInstance: typeof MonacoType) => void
  captureSemanticHighlightingEditor: (editor: StandaloneEditor) => void
  onMount?: (editor: StandaloneEditor) => void
}

function selectedTextOf(editor: StandaloneEditor): string {
  const model = editor.getModel()
  const selection = editor.getSelection()
  if (!model) return ''
  if (!selection) return ''
  return model.getValueInRange(selection)
}

function bindEditorEvents(
  editor: StandaloneEditor,
  monacoInstance: typeof MonacoType,
  inputs: EditorMountInputs
): MonacoType.IDisposable[] {
  const { tabId, isOverrideMode } = inputs
  const caretOccurrenceDisposables = bindCaretOccurrenceHighlight(editor, monacoInstance)
  const syncSelectedText = () => {
    if (isOverrideMode) return
    useQueryStore.getState().setSelectedText(tabId, selectedTextOf(editor))
  }
  const queryStoreDisposables = isOverrideMode
    ? []
    : bindQueryStoreEditorEvents({
        editor: editor,
        tabId: tabId,
        connectionId: inputs.connectionId,
        syncSelectedText: syncSelectedText,
      })
  const contentChangeDisposable = editor.onDidChangeModelContent(() => {
    syncSelectedText()
    syncAttachedContextToEditor(editor, tabId)
  })
  const findReplaceActionDisposable = addFindReplaceAction(editor, monacoInstance)
  return [
    ...queryStoreDisposables,
    ...caretOccurrenceDisposables,
    findReplaceActionDisposable,
    contentChangeDisposable,
  ]
}

const MONACO_THEME_SCOPE_CLASS = 'monaco-component'

// Monaco 0.57 mounts the fixedOverflowWidgets context menu in a shadow root beside .monaco-editor, outside its theme variables.
function shareThemeVariablesWithContextMenu(editor: StandaloneEditor) {
  editor.getContainerDomNode().classList.add(MONACO_THEME_SCOPE_CLASS)
}

export function useEditorMountHandler(inputs: EditorMountInputs) {
  return function handleEditorMount(editor: StandaloneEditor, monacoInstance: typeof MonacoType) {
    inputs.editorRef.current = editor
    inputs.captureModelOnMount(editor)
    inputs.captureSemanticHighlightingEditor(editor)
    inputs.applyThemeOnMount(monacoInstance)
    shareThemeVariablesWithContextMenu(editor)
    if (!inputs.isOverrideMode) restoreCursorPosition(editor, inputs.tabId)
    const disposables = bindEditorEvents(editor, monacoInstance, inputs)
    editor.onDidDispose(() => {
      disposables.forEach((disposable) => disposable.dispose())
      inputs.releaseModelOnDispose()
    })
    registerShortcutCommands(editor, monacoInstance, inputs.shortcutBindings)
    inputs.onMount?.(editor)
  }
}
