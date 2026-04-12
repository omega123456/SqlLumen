/**
 * Pure-logic helpers for diff overlay operations in the query editor.
 * Extracted from QueryEditorTab callbacks to enable isolated unit testing.
 */

import type * as MonacoType from 'monaco-editor'
import * as monaco from 'monaco-editor'
import { showErrorToast } from '../../stores/toast-store'
import { useAiStore } from '../../stores/ai-store'

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

/**
 * Build the diff overlay state by extracting the original SQL from the editor model.
 * Returns the new state, or null if the editor model is unavailable.
 */
export function buildDiffState(
  editor: MonacoType.editor.IStandaloneCodeEditor | null,
  proposedSql: string,
  range: PlainRange
): DiffOverlayState | null {
  const model = editor?.getModel()
  if (!model) {
    console.error('[query-editor] Cannot open diff: no editor model')
    return null
  }

  const monacoRange = new monaco.Range(
    range.startLineNumber,
    range.startColumn,
    range.endLineNumber,
    range.endColumn
  )
  const originalSql = model.getValueInRange(monacoRange)

  return {
    visible: true,
    originalSql,
    proposedSql,
    originalRange: range,
  }
}

/**
 * Compute the new end position for a range after replacing its content with `finalSql`.
 * The start position stays fixed; the end is recalculated from the number of lines
 * and the length of the last line in `finalSql`.
 */
export function computeUpdatedRange(originalRange: PlainRange, finalSql: string): PlainRange {
  const lines = finalSql.split('\n')
  const newEndLine = originalRange.startLineNumber + lines.length - 1
  const newEndCol =
    lines.length === 1
      ? originalRange.startColumn + finalSql.length
      : lines[lines.length - 1].length + 1
  return {
    ...originalRange,
    endLineNumber: newEndLine,
    endColumn: newEndCol,
  }
}

/**
 * Apply the given SQL to the editor, replacing the original range.
 * Returns true if the replacement was applied, false if the editor model
 * is unavailable. The editor is read-only during `ai-reviewing` status,
 * so content cannot have changed — no staleness check is needed.
 *
 * When `tabId` is provided and the tab has an attached AI context,
 * the context is updated to reflect the new SQL and recalculated range
 * so that followup AI prompts reference the current editor content.
 */
export function applyDiff(
  editor: MonacoType.editor.IStandaloneCodeEditor | null,
  state: DiffOverlayState,
  finalSql: string,
  tabId?: string
): boolean {
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

  // Use model.pushEditOperations instead of editor.executeEdits because the
  // main editor is set to readOnly during ai-reviewing status. executeEdits
  // silently drops edits when readOnly is true, but pushEditOperations
  // bypasses the readOnly flag and writes directly to the underlying model.
  model.pushEditOperations([], [{ range: monacoRange, text: finalSql }], () => null)

  // Keep the AI attached context in sync so followup prompts diff against
  // the accepted SQL rather than the stale original.
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

/**
 * Restore tab status after diff overlay is dismissed (accept or reject).
 */
export function restoreTabAfterDiff(tabId: string): void {
  useAiStore.getState().restoreTabStatus(tabId)
}
