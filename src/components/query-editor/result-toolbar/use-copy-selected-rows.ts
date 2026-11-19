import type { DataViewSurfaceRef } from '../../../stores/data-view/data-view-types'
import { useCallback } from 'react'
import { countRanges, useQueryStore, type RowActionHandle } from '../../../stores/query-store'
import { showErrorToast, useToastStore } from '../../../stores/toast-store'
import { serializeCsv } from '../../../lib/csv-utils'
import { writeClipboardText } from '../../../lib/context-menu-utils'
import { CLIPBOARD_ACTION_FAILURES } from '../../../lib/clipboard-action-failures'
import { logFrontend } from '../../../lib/app-log-commands'
import {
  RESULT_MAX_CHUNK_ROWS,
  isAbortError,
  isResultsExpiredError,
  readViewRange,
  type CachedRow,
} from '../../../lib/result-window-cache'
import { toErrorMessage } from '../../../lib/error-message'
import type { ColumnMeta } from '../../../types/schema'
import { copiedRowsToast, type ActiveResult } from './result-toolbar-model'

type CheckedRanges = ActiveResult['checkedRanges']

interface CheckedRowsRead {
  tabId: string
  resultIndex: number
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
      tabId: read.tabId,
      resultIndex: read.resultIndex,
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

function showCopyFailure(): void {
  showErrorToast(CLIPBOARD_ACTION_FAILURES.copy.title, CLIPBOARD_ACTION_FAILURES.copy.message)
}

function handleReadFailure(error: unknown, onExpired: () => void): void {
  if (isAbortError(error)) return
  if (isResultsExpiredError(error)) {
    onExpired()
    return
  }
  logFrontend('warn', `[result-toolbar] could not load checked rows: ${toErrorMessage(error)}`)
  showCopyFailure()
}

interface ClipboardCopy {
  columns: ColumnMeta[]
  rows: CachedRow[]
  wasVisible: boolean
  showSuccess: (title: string, message: string) => void
}

async function writeRowsToClipboard({ columns, rows, wasVisible, showSuccess }: ClipboardCopy) {
  try {
    await writeClipboardText(
      serializeCsv(
        columns.map((column) => column.name),
        rows.map((row) => row.row)
      )
    )
    const toast = copiedRowsToast(wasVisible, rows.length)
    showSuccess(toast.title, toast.message)
  } catch (error) {
    logFrontend('warn', `[result-toolbar] clipboard write failed: ${toErrorMessage(error)}`)
    showCopyFailure()
  }
}

interface CopySelectedRowsInputs {
  surfaceRef: DataViewSurfaceRef
  columns: ColumnMeta[]
  checkedRanges: CheckedRanges
}

export function useCopySelectedRows(inputs: CopySelectedRowsInputs) {
  const { surfaceRef, columns, checkedRanges } = inputs
  const beginRowAction = useQueryStore((state) => state.beginRowAction)
  const markResultsExpired = useQueryStore((state) => state.markResultsExpired)
  const showSuccess = useToastStore((state) => state.showSuccess)

  return useCallback(async () => {
    if (checkedRanges.length === 0) return
    const controller = new AbortController()
    const spansSeveralChunks = chunkCountOf(checkedRanges) > 1
    const action = beginRowAction(surfaceRef, {
      verb: 'Copying',
      total: countRanges(checkedRanges),
      onCancel: spansSeveralChunks ? () => controller.abort() : undefined,
    })
    let rows: CachedRow[]
    try {
      rows = await readCheckedRows({
        tabId: surfaceRef.tabId,
        resultIndex: surfaceRef.resultIndex,
        checkedRanges: checkedRanges,
        action: action,
        signal: controller.signal,
      })
    } catch (error) {
      action.finish()
      handleReadFailure(error, () => markResultsExpired(surfaceRef.tabId))
      return
    }
    const wasVisible = action.finish()
    await writeRowsToClipboard({ columns, rows, wasVisible, showSuccess })
  }, [columns, beginRowAction, checkedRanges, markResultsExpired, showSuccess, surfaceRef])
}
