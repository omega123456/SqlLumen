import type * as MonacoType from 'monaco-editor'
import { useQueryStore } from '../../../stores/query-store'
import { useAiStore } from '../../../stores/ai-store'
import { useFavoritesStore } from '../../../stores/favorites-store'
import { resolveFavoriteSql, buildFavoriteDraft } from '../save-favorite-utils'

const SAVE_FAVORITE_MENU_ORDER = 1.5

export type StandaloneEditor = MonacoType.editor.IStandaloneCodeEditor

export function restoreCursorPosition(editor: StandaloneEditor, tabId: string): void {
  const savedPosition = useQueryStore.getState().tabs[tabId]?.cursorPosition
  if (!savedPosition) return
  editor.setPosition(savedPosition)
  editor.revealPositionInCenter(savedPosition)
}

function saveFavoriteFromEditor(
  editor: MonacoType.editor.ICodeEditor,
  connectionId: string | undefined
): void {
  const model = editor.getModel()
  if (!model) return

  const selection = editor.getSelection()
  const selectedText = selection ? model.getValueInRange(selection) : ''
  const position = editor.getPosition()
  const sql = resolveFavoriteSql(
    model.getValue(),
    selectedText,
    position ? { lineNumber: position.lineNumber, column: position.column } : null
  )
  if (!sql) return

  useFavoritesStore.getState().openDialog(buildFavoriteDraft(sql, connectionId ?? null))
}

export function syncAttachedContextToEditor(editor: StandaloneEditor, tabId: string): void {
  const context = useAiStore.getState().tabs[tabId]?.attachedContext
  if (!context) return
  const editorModel = editor.getModel()
  if (!editorModel) return
  const lineCount = editorModel.getLineCount()
  useAiStore.getState().setAttachedContext(tabId, {
    sql: editorModel.getValue(),
    range: {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: lineCount,
      endColumn: editorModel.getLineLength(lineCount) + 1,
    },
  })
}

interface QueryStoreEditorBinding {
  editor: StandaloneEditor
  tabId: string
  connectionId: string | undefined
  syncSelectedText: () => void
}

export function bindQueryStoreEditorEvents(
  binding: QueryStoreEditorBinding
): MonacoType.IDisposable[] {
  const { editor, tabId } = binding
  const cursorDisposable = editor.onDidChangeCursorPosition((event) => {
    useQueryStore.getState().setCursorPosition(tabId, {
      lineNumber: event.position.lineNumber,
      column: event.position.column,
    })
  })
  const selectionDisposable = editor.onDidChangeCursorSelection(() => {
    binding.syncSelectedText()
  })
  binding.syncSelectedText()

  const saveFavoriteActionDisposable = editor.addAction({
    id: 'sqllumen.save-as-favorite',
    label: 'Save as favorite',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: SAVE_FAVORITE_MENU_ORDER,
    run: (codeEditor) => saveFavoriteFromEditor(codeEditor, binding.connectionId),
  })
  return [cursorDisposable, selectionDisposable, saveFavoriteActionDisposable]
}
