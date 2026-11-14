import { logFrontend } from '../../../../lib/app-log-commands'
import {
  CLIPBOARD_ACTION_FAILURES,
  type ClipboardActionFailure,
} from '../../../../lib/clipboard-action-failures'
import { toErrorMessage } from '../../../../lib/error-message'
import { formatCount } from '../../../../lib/format-row-count'
import { showErrorToast, showSuccessToast } from '../../../../stores/toast-store'
import type { GridRowActions, GridRowActionVerb } from './canvas-grid-types'
import type { RowProgress } from './grid-row-ranges'

export const ROW_ACTION_FAILURES: Record<GridRowActionVerb, ClipboardActionFailure> = {
  Copying: CLIPBOARD_ACTION_FAILURES.copy,
  Cutting: CLIPBOARD_ACTION_FAILURES.cut,
  Clearing: CLIPBOARD_ACTION_FAILURES.clear,
  Pasting: CLIPBOARD_ACTION_FAILURES.paste,
}

interface RowActionToast {
  title: string
  message: string
}

const ROW_ACTION_SUCCESS: Record<GridRowActionVerb, (rows: string) => RowActionToast> = {
  Copying: (rows) => ({ title: 'Copied', message: `${rows} copied to clipboard.` }),
  Cutting: (rows) => ({ title: 'Cut', message: `${rows} cut.` }),
  Clearing: (rows) => ({ title: 'Cleared', message: `${rows} cleared.` }),
  Pasting: (rows) => ({ title: 'Pasted', message: `${rows} updated.` }),
}

function rowActionSuccess(verb: GridRowActionVerb, count: number): RowActionToast {
  const rows = `${formatCount(count)} ${count === 1 ? 'row' : 'rows'}`
  return ROW_ACTION_SUCCESS[verb](rows)
}

export function showRowActionSuccess(verb: GridRowActionVerb, count: number): void {
  const { title, message } = rowActionSuccess(verb, count)
  showSuccessToast(title, message)
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isResultsExpired(error: unknown): boolean {
  return toErrorMessage(error).includes('results_expired')
}

export function finishRowProgress(progress: RowProgress | undefined): boolean {
  return progress?.finish() ?? false
}

export function reportRowActionLoadFailure(
  verb: GridRowActionVerb,
  error: unknown,
  rowActions: GridRowActions | undefined
): void {
  if (isAbort(error)) return
  if (isResultsExpired(error)) {
    rowActions?.onExpired()
    return
  }
  const failure = ROW_ACTION_FAILURES[verb]
  logFrontend('warn', `[grid] ${verb} could not load rows: ${toErrorMessage(error)}`)
  showErrorToast(failure.title, failure.message)
}

export function reportClipboardWriteFailure(verb: GridRowActionVerb, error: unknown): void {
  const failure = ROW_ACTION_FAILURES[verb]
  logFrontend('warn', `Failed to write grid selection to clipboard: ${toErrorMessage(error)}`)
  showErrorToast(failure.title, failure.message)
}

export function reportClipboardReadFailure(error: unknown): void {
  logFrontend('warn', `Failed to read grid clipboard text: ${toErrorMessage(error)}`)
  showErrorToast(ROW_ACTION_FAILURES.Pasting.title, ROW_ACTION_FAILURES.Pasting.message)
}
