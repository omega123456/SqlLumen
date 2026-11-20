import type * as MonacoType from 'monaco-editor'
import type { StandaloneEditor } from './editor-store-bindings'

const OTHER_OCCURRENCE_DECORATION: MonacoType.editor.IModelDecorationOptions = {
  className: 'word-occurrence-fill',
  inlineClassName: 'font-semibold',
}

const SEARCH_ONLY_EDITABLE_RANGE = true
const IS_REGEX = false
const MATCH_CASE = true
const CAPTURE_MATCHES = false

function isSingleLine(selection: MonacoType.Selection): boolean {
  return selection.startLineNumber === selection.endLineNumber
}

function wordContainingSelection(
  model: MonacoType.editor.ITextModel,
  selection: MonacoType.Selection
): MonacoType.editor.IWordAtPosition | null {
  if (!isSingleLine(selection)) return null
  const word = model.getWordAtPosition(selection.getPosition())
  if (!word) return null
  const selectionIsInsideWord =
    word.startColumn <= selection.startColumn && selection.endColumn <= word.endColumn
  return selectionIsInsideWord ? word : null
}

export function otherOccurrenceRanges(
  model: MonacoType.editor.ITextModel,
  selection: MonacoType.Selection,
  wordSeparators: string
): MonacoType.IRange[] {
  const caretWord = wordContainingSelection(model, selection)
  if (!caretWord) return []
  const isCaretWord = (range: MonacoType.IRange) =>
    range.startLineNumber === selection.startLineNumber &&
    range.startColumn === caretWord.startColumn
  return model
    .findMatches(
      caretWord.word,
      SEARCH_ONLY_EDITABLE_RANGE,
      IS_REGEX,
      MATCH_CASE,
      wordSeparators,
      CAPTURE_MATCHES
    )
    .map((match) => match.range)
    .filter((range) => !isCaretWord(range))
}

function otherOccurrenceDecorations(
  editor: StandaloneEditor,
  monacoInstance: typeof MonacoType
): MonacoType.editor.IModelDeltaDecoration[] {
  const model = editor.getModel()
  const selection = editor.getSelection()
  if (!model) return []
  if (!selection) return []
  const wordSeparators = editor.getOption(monacoInstance.editor.EditorOption.wordSeparators)
  return otherOccurrenceRanges(model, selection, wordSeparators).map((range) => ({
    range: range,
    options: OTHER_OCCURRENCE_DECORATION,
  }))
}

export function bindCaretOccurrenceHighlight(
  editor: StandaloneEditor,
  monacoInstance: typeof MonacoType
): MonacoType.IDisposable[] {
  const decorations = editor.createDecorationsCollection()
  const refresh = () => decorations.set(otherOccurrenceDecorations(editor, monacoInstance))
  return [
    editor.onDidChangeCursorSelection(refresh),
    editor.onDidChangeModelContent(refresh),
    { dispose: () => decorations.clear() },
  ]
}
