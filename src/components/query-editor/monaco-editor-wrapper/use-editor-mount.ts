import type { RefObject } from 'react'
import type * as MonacoType from 'monaco-editor'
import { useQueryStore } from '../../../stores/query-store'
import {
  bindQueryStoreEditorEvents,
  restoreCursorPosition,
  syncAttachedContextToEditor,
  type StandaloneEditor,
} from './editor-store-bindings'
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
  return [...queryStoreDisposables, findReplaceActionDisposable, contentChangeDisposable]
}

export function useEditorMountHandler(inputs: EditorMountInputs) {
  return function handleEditorMount(editor: StandaloneEditor, monacoInstance: typeof MonacoType) {
    inputs.editorRef.current = editor
    inputs.captureModelOnMount(editor)
    inputs.captureSemanticHighlightingEditor(editor)
    inputs.applyThemeOnMount(monacoInstance)
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
