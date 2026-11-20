import { useCallback } from 'react'
import type {
  DataViewState,
  DataViewSurfaceRef,
} from '../../../../stores/data-view/data-view-types'
import { routeOf } from '../../../../stores/data-view/route-registry'
import { boundColumnIndexOf } from '../../../../stores/data-view/data-view-selectors'
import { currentView } from '../../../../stores/data-view/use-data-view'
import {
  beginRowAction,
  type RowActionHandle,
} from '../../../../stores/data-view/row-action-progress'
import { countRanges } from '../../../../lib/view-ranges'
import { showErrorToast, useToastStore } from '../../../../stores/toast-store'
import { serializeCsv } from '../../../../lib/csv-utils'
import { writeClipboardText } from '../../../../lib/context-menu-utils'
import { CLIPBOARD_ACTION_FAILURES } from '../../../../lib/clipboard-action-failures'
import { logFrontend } from '../../../../lib/app-log-commands'
import {
  RESULT_MAX_CHUNK_ROWS,
  isAbortError,
  isResultsExpiredError,
  readViewRange,
  type CachedRow,
} from '../../../../lib/result-window-cache'
import { toErrorMessage } from '../../../../lib/error-message'
import { copiedRowsToast, sortedCheckedRanges } from './data-toolbar-model'

type CheckedRanges = DataViewState['checked']['ranges']

interface CheckedRowsRead {
  ref: DataViewSurfaceRef
  checkedRanges: CheckedRanges
  action: RowActionHandle
  signal: AbortSignal
}

function chunkCountOf(checkedRanges: CheckedRanges): number {
  return checkedRanges.reduce(
    (sum, [start, end]) => sum + Math.ceil((end - start) / RESULT_MAX_CHUNK_ROWS),
    0
  )
}

async function readCheckedRows(read: CheckedRowsRead): Promise<CachedRow[]> {
  let rows: CachedRow[] = []
  for (const range of read.checkedRanges) {
    const doneBefore = rows.length
    const chunk = await readViewRange({
      tabId: read.ref.tabId,
      resultIndex: read.ref.resultIndex,
      range: range,
      options: {
        signal: read.signal,
        onProgress: ({ done }) => read.action.update(doneBefore + done),
      },
    })
    rows = rows.concat(chunk)
  }
  return rows
}

function withUnsavedEdits(cached: CachedRow, view: DataViewState): unknown[] {
  const editState = view.edit.state
  if (!editState) return cached.row
  const isEditedRow = cached.baseIndex === view.edit.baseIndex
  if (!isEditedRow) return cached.row
  const row = [...cached.row]
  for (const [columnName, value] of Object.entries(editState.currentValues)) {
    const columnIndex = boundColumnIndexOf(view, columnName)
    if (columnIndex === undefined) continue
    row[columnIndex] = value
  }
  return row
}

function showCopyFailure(): void {
  showErrorToast(CLIPBOARD_ACTION_FAILURES.copy.title, CLIPBOARD_ACTION_FAILURES.copy.message)
}

function handleReadFailure(error: unknown, ref: DataViewSurfaceRef): void {
  if (isAbortError(error)) return
  if (isResultsExpiredError(error)) {
    routeOf(ref).lifecycle.onExpired(ref)
    return
  }
  logFrontend('warn', `[data-toolbar] could not load checked rows: ${toErrorMessage(error)}`)
  showCopyFailure()
}

interface ClipboardCopy {
  view: DataViewState
  rows: CachedRow[]
  wasVisible: boolean
  showSuccess: (title: string, message: string) => void
}

async function writeRowsToClipboard({ view, rows, wasVisible, showSuccess }: ClipboardCopy) {
  try {
    await writeClipboardText(
      serializeCsv(
        view.slot.columns.map((column) => column.name),
        rows.map((cached) => withUnsavedEdits(cached, view))
      )
    )
    const toast = copiedRowsToast(wasVisible, rows.length)
    showSuccess(toast.title, toast.message)
  } catch (error) {
    logFrontend('warn', `[data-toolbar] clipboard write failed: ${toErrorMessage(error)}`)
    showCopyFailure()
  }
}

type SuccessToast = ClipboardCopy['showSuccess']

async function copyCheckedRows(ref: DataViewSurfaceRef, showSuccess: SuccessToast) {
  const view = currentView(ref)
  const checkedRanges = sortedCheckedRanges(view)
  if (checkedRanges.length === 0) return
  const controller = new AbortController()
  const spansSeveralChunks = chunkCountOf(checkedRanges) > 1
  const action = beginRowAction(ref, {
    verb: 'Copying',
    total: countRanges(checkedRanges),
    onCancel: spansSeveralChunks ? () => controller.abort() : undefined,
  })
  let rows: CachedRow[]
  try {
    rows = await readCheckedRows({
      ref: ref,
      checkedRanges: checkedRanges,
      action: action,
      signal: controller.signal,
    })
  } catch (error) {
    action.finish()
    handleReadFailure(error, ref)
    return
  }
  const wasVisible = action.finish()
  await writeRowsToClipboard({ view, rows, wasVisible, showSuccess })
}

export function useCopyCheckedRows(ref: DataViewSurfaceRef): () => Promise<void> {
  const showSuccess = useToastStore((state) => state.showSuccess)
  return useCallback(() => copyCheckedRows(ref, showSuccess), [ref, showSuccess])
}
