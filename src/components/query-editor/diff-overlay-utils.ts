import { logFrontend } from '../../lib/app-log-commands'

import type * as MonacoType from 'monaco-editor'
import * as monaco from 'monaco-editor'
import { showErrorToast } from '../../stores/toast-store'
import { useAiStore } from '../../stores/ai-store'

export interface LineChange {
  originalStartLineNumber: number
  originalEndLineNumber: number
  modifiedStartLineNumber: number
  modifiedEndLineNumber: number
}

interface HunkEdit {
  range: monaco.IRange
  text: string
}

function modifiedHunkText(change: LineChange, modifiedModel: monaco.editor.ITextModel): string {
  if (change.modifiedEndLineNumber === 0) return ''
  return modifiedModel.getValueInRange({
    startLineNumber: change.modifiedStartLineNumber,
    startColumn: 1,
    endLineNumber: change.modifiedEndLineNumber,
    endColumn: modifiedModel.getLineMaxColumn(change.modifiedEndLineNumber),
  })
}

function fullLinesRange(
  model: monaco.editor.ITextModel,
  startLineNumber: number,
  endLineNumber: number
): monaco.IRange {
  return {
    startLineNumber: startLineNumber,
    startColumn: 1,
    endLineNumber: endLineNumber,
    endColumn: model.getLineMaxColumn(endLineNumber),
  }
}

function insertionEdit(
  change: LineChange,
  originalModel: monaco.editor.ITextModel,
  text: string
): HunkEdit {
  const lineCount = originalModel.getLineCount()
  if (change.originalStartLineNumber >= lineCount) {
    const lastColumn = originalModel.getLineMaxColumn(lineCount)
    return {
      range: {
        startLineNumber: lineCount,
        startColumn: lastColumn,
        endLineNumber: lineCount,
        endColumn: lastColumn,
      },
      text: '\n' + text,
    }
  }
  const insertLineNumber = change.originalStartLineNumber + 1
  return {
    range: {
      startLineNumber: insertLineNumber,
      startColumn: 1,
      endLineNumber: insertLineNumber,
      endColumn: 1,
    },
    text: text + '\n',
  }
}

function deletionRange(change: LineChange, originalModel: monaco.editor.ITextModel): monaco.IRange {
  const { originalStartLineNumber, originalEndLineNumber } = change
  const originalLineCount = originalModel.getLineCount()
  if (originalEndLineNumber < originalLineCount) {
    return {
      startLineNumber: originalStartLineNumber,
      startColumn: 1,
      endLineNumber: originalEndLineNumber + 1,
      endColumn: 1,
    }
  }
  if (originalStartLineNumber > 1) {
    const previousLineNumber = originalStartLineNumber - 1
    return {
      startLineNumber: previousLineNumber,
      startColumn: originalModel.getLineMaxColumn(previousLineNumber),
      endLineNumber: originalEndLineNumber,
      endColumn: originalModel.getLineMaxColumn(originalEndLineNumber),
    }
  }
  return fullLinesRange(originalModel, originalStartLineNumber, originalEndLineNumber)
}

function resolveHunkEdit(
  change: LineChange,
  originalModel: monaco.editor.ITextModel,
  text: string
): HunkEdit {
  if (change.originalEndLineNumber === 0) return insertionEdit(change, originalModel, text)
  if (change.modifiedEndLineNumber === 0) {
    return { range: deletionRange(change, originalModel), text: text }
  }
  const range = fullLinesRange(
    originalModel,
    change.originalStartLineNumber,
    change.originalEndLineNumber
  )
  return { range: range, text: text }
}

export function applyHunkToOriginal(
  change: LineChange,
  origModel: monaco.editor.ITextModel,
  modifiedModel: monaco.editor.ITextModel
): void {
  const edit = resolveHunkEdit(change, origModel, modifiedHunkText(change, modifiedModel))
  origModel.pushEditOperations([], [edit], () => null)
}

export interface PlainRange {
  startLineNumber: number
  endLineNumber: number
  startColumn: number
  endColumn: number
}

export interface DiffOverlayState {
  visible: boolean
  originalSql: string
  proposedSql: string
  originalRange: PlainRange
}

export const DIFF_OVERLAY_INITIAL: DiffOverlayState = {
  visible: false,
  originalSql: '',
  proposedSql: '',
  originalRange: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 1 },
}

export function buildDiffState(
  editor: MonacoType.editor.IStandaloneCodeEditor | null,
  proposedSql: string,
  range: PlainRange
): DiffOverlayState | null {
  const model = editor?.getModel()
  if (!model) {
    logFrontend('error', '[query-editor] Cannot open diff: no editor model')
    return null
  }

  const monacoRange = new monaco.Range(
    range.startLineNumber,
    range.startColumn,
    range.endLineNumber,
    range.endColumn
  )
  const originalSql = model.getValueInRange(monacoRange)
  const trimmedSql = proposedSql.trimEnd()

  return {
    visible: true,
    originalSql: originalSql,
    proposedSql: originalSql.trimEnd().endsWith(';') ? trimmedSql : trimmedSql.replace(/;$/, ''),
    originalRange: range,
  }
}

export function computeUpdatedRange(originalRange: PlainRange, finalSql: string): PlainRange {
  const lines = finalSql.split('\n')
  const newEndLine = originalRange.startLineNumber + lines.length - 1
  const newEndColumn =
    lines.length === 1
      ? originalRange.startColumn + finalSql.length
      : lines[lines.length - 1].length + 1
  return {
    ...originalRange,
    endLineNumber: newEndLine,
    endColumn: newEndColumn,
  }
}

export interface DiffApplication {
  editor: MonacoType.editor.IStandaloneCodeEditor | null
  state: DiffOverlayState
  finalSql: string
  tabId?: string
}

export function applyDiff({ editor, state, finalSql, tabId }: DiffApplication): boolean {
  const { originalRange } = state
  const model = editor?.getModel()

  if (!model) {
    showErrorToast('Could not apply changes', 'Editor model is unavailable')
    return false
  }

  const monacoRange = new monaco.Range(
    originalRange.startLineNumber,
    originalRange.startColumn,
    originalRange.endLineNumber,
    originalRange.endColumn
  )

  model.pushEditOperations([], [{ range: monacoRange, text: finalSql }], () => null)

  if (tabId) {
    const existingContext = useAiStore.getState().tabs[tabId]?.attachedContext
    if (existingContext) {
      useAiStore.getState().setAttachedContext(tabId, {
        sql: finalSql,
        range: computeUpdatedRange(originalRange, finalSql),
      })
    }
  }

  return true
}

export function restoreTabAfterDiff(tabId: string): void {
  useAiStore.getState().restoreTabStatus(tabId)
}
