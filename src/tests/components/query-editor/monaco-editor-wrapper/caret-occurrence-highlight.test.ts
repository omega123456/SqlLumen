import { describe, it, expect, vi } from 'vitest'
import type * as MonacoType from 'monaco-editor'
import {
  bindCaretOccurrenceHighlight,
  otherOccurrenceRanges,
} from '../../../../components/query-editor/monaco-editor-wrapper/caret-occurrence-highlight'
import type { StandaloneEditor } from '../../../../components/query-editor/monaco-editor-wrapper/editor-store-bindings'

const WORD_PATTERN = /\w+/g
const WORD_SEPARATORS = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?'
const SQL = ['SELECT id, name', 'FROM users', 'WHERE id > 10 AND name IS NOT NULL']

interface SelectionSpan {
  line: number
  startColumn: number
  endColumn: number
  endLine?: number
}

function wordsOnLine(text: string, lineNumber: number) {
  return [...text.matchAll(WORD_PATTERN)].map((match) => ({
    word: match[0],
    startColumn: match.index + 1,
    endColumn: match.index + 1 + match[0].length,
    lineNumber: lineNumber,
  }))
}

function createModel(lines: string[]): MonacoType.editor.ITextModel {
  const words = lines.flatMap((text, index) => wordsOnLine(text, index + 1))
  const model = {
    getWordAtPosition: (position: MonacoType.IPosition) =>
      words.find(
        (word) =>
          word.lineNumber === position.lineNumber &&
          word.startColumn <= position.column &&
          position.column <= word.endColumn
      ) ?? null,
    findMatches: (searchString: string) =>
      words
        .filter((word) => word.word === searchString)
        .map((word) => ({
          range: {
            startLineNumber: word.lineNumber,
            startColumn: word.startColumn,
            endLineNumber: word.lineNumber,
            endColumn: word.endColumn,
          },
        })),
  }
  return model as unknown as MonacoType.editor.ITextModel
}

function createSelection(span: SelectionSpan): MonacoType.Selection {
  const endLine = span.endLine ?? span.line
  const selection = {
    startLineNumber: span.line,
    startColumn: span.startColumn,
    endLineNumber: endLine,
    endColumn: span.endColumn,
    getPosition: () => ({ lineNumber: endLine, column: span.endColumn }),
  }
  return selection as unknown as MonacoType.Selection
}

function rangeOn(line: number, startColumn: number, endColumn: number): MonacoType.IRange {
  return {
    startLineNumber: line,
    startColumn: startColumn,
    endLineNumber: line,
    endColumn: endColumn,
  }
}

describe('otherOccurrenceRanges', () => {
  const model = createModel(SQL)

  it('marks the other occurrences of the word under the caret but not the caret word', () => {
    const caretInsideId = createSelection({ line: 1, startColumn: 9, endColumn: 9 })
    expect(otherOccurrenceRanges(model, caretInsideId, WORD_SEPARATORS)).toEqual([rangeOn(3, 7, 9)])

    const nameDoubleClicked = createSelection({ line: 1, startColumn: 12, endColumn: 16 })
    expect(otherOccurrenceRanges(model, nameDoubleClicked, WORD_SEPARATORS)).toEqual([
      rangeOn(3, 19, 23),
    ])
  })

  it('marks nothing when the caret is not on a word', () => {
    const caretAfterComma = createSelection({ line: 3, startColumn: 10, endColumn: 10 })
    expect(otherOccurrenceRanges(model, caretAfterComma, WORD_SEPARATORS)).toEqual([])
  })

  it('marks nothing when the selection reaches past one word or across lines', () => {
    const selectionPastId = createSelection({ line: 1, startColumn: 8, endColumn: 14 })
    expect(otherOccurrenceRanges(model, selectionPastId, WORD_SEPARATORS)).toEqual([])

    const multiLineSelection = createSelection({
      line: 1,
      startColumn: 8,
      endColumn: 3,
      endLine: 2,
    })
    expect(otherOccurrenceRanges(model, multiLineSelection, WORD_SEPARATORS)).toEqual([])
  })
})

describe('bindCaretOccurrenceHighlight', () => {
  function createEditor(model: MonacoType.editor.ITextModel | null) {
    const decorations = { set: vi.fn(), clear: vi.fn() }
    const listeners: Array<() => void> = []
    const register = (listener: () => void) => {
      listeners.push(listener)
      return { dispose: vi.fn() }
    }
    const editor = {
      createDecorationsCollection: () => decorations,
      onDidChangeCursorSelection: register,
      onDidChangeModelContent: register,
      getModel: () => model,
      getSelection: () => createSelection({ line: 1, startColumn: 9, endColumn: 9 }),
      getOption: () => WORD_SEPARATORS,
    }
    return { editor: editor as unknown as StandaloneEditor, decorations, listeners }
  }

  const monacoInstance = {
    editor: { EditorOption: { wordSeparators: 0 } },
  } as unknown as typeof MonacoType

  it('redraws the decorations on caret and content changes and clears them on dispose', () => {
    const { editor, decorations, listeners } = createEditor(createModel(SQL))
    const disposables = bindCaretOccurrenceHighlight(editor, monacoInstance)

    listeners.forEach((listener) => listener())
    expect(decorations.set).toHaveBeenCalledTimes(listeners.length)
    const [decorated] = decorations.set.mock.calls[0]
    expect(decorated.map((decoration: { range: MonacoType.IRange }) => decoration.range)).toEqual([
      rangeOn(3, 7, 9),
    ])

    disposables.forEach((disposable) => disposable.dispose())
    expect(decorations.clear).toHaveBeenCalledTimes(1)
  })

  it('draws nothing while the editor has no model', () => {
    const { editor, decorations, listeners } = createEditor(null)
    bindCaretOccurrenceHighlight(editor, monacoInstance)

    listeners[0]()
    expect(decorations.set).toHaveBeenCalledWith([])
  })
})
