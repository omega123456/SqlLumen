import { RESULT_LOADING_STATUS_DELAY_MS } from '../../lib/result-window-cache'
import type { RowActionHandle, RowActionProgress, RowActionStart } from './query-state-types'
import { getActiveIndex, patchResultByIndex, resultAt } from './query-store-access'

export const rowActionCancels = new Map<string, () => void>()

export function beginRowAction(
  tabId: string,
  { verb, total, onCancel }: RowActionStart
): RowActionHandle {
  const resultIndex = getActiveIndex(tabId)
  const queryId = resultAt(tabId, resultIndex)?.queryId ?? null
  let done = 0
  let visible = false
  let finished = false
  const patchProgress = (progress: RowActionProgress | null) => {
    const current = resultAt(tabId, resultIndex)
    if (current?.queryId !== queryId) return
    patchResultByIndex(tabId, resultIndex, { rowActionProgress: progress })
  }
  const snapshot = (): RowActionProgress => ({
    verb: verb,
    done: done,
    total: total,
    cancellable: onCancel !== undefined,
    visible: visible,
  })
  if (onCancel) rowActionCancels.set(tabId, onCancel)
  patchProgress(snapshot())
  const timer = setTimeout(() => {
    if (finished) return
    visible = true
    patchProgress(snapshot())
  }, RESULT_LOADING_STATUS_DELAY_MS)
  return {
    update: (nextDone: number) => {
      done = nextDone
      const isShowingProgress = visible && !finished
      if (isShowingProgress) patchProgress(snapshot())
    },
    finish: () => {
      finished = true
      clearTimeout(timer)
      const isOwnCancelHandler = rowActionCancels.get(tabId) === onCancel
      if (isOwnCancelHandler) rowActionCancels.delete(tabId)
      patchProgress(null)
      return visible
    },
  }
}

export function cancelRowAction(tabId: string) {
  const cancel = rowActionCancels.get(tabId)
  if (!cancel) return
  rowActionCancels.delete(tabId)
  cancel()
}

export function rowActionProgressActions() {
  return { beginRowAction, cancelRowAction }
}
