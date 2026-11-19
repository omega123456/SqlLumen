import { RESULT_LOADING_STATUS_DELAY_MS } from '../../lib/result-window-cache'
import type { RowActionHandle, RowActionProgress, RowActionStart } from './query-state-types'
import type { DataViewSurfaceRef } from '../data-view/data-view-types'
import { patchSurface, resultOf } from './query-store-access'

const rowActionCancels = new Map<string, () => void>()

function rowActionKeyOf(ref: DataViewSurfaceRef): string {
  return `${ref.tabId}:${ref.resultIndex}`
}

export function dropRowActionCancels(tabId: string) {
  for (const key of rowActionCancels.keys()) {
    if (key.startsWith(`${tabId}:`)) rowActionCancels.delete(key)
  }
}

export function beginRowAction(
  ref: DataViewSurfaceRef,
  { verb, total, onCancel }: RowActionStart
): RowActionHandle {
  const actionKey = rowActionKeyOf(ref)
  const queryId = resultOf(ref)?.view.slot.queryId ?? null
  let done = 0
  let visible = false
  let finished = false
  const patchProgress = (progress: RowActionProgress | null) => {
    const current = resultOf(ref)
    const currentQueryId = current?.view.slot.queryId
    if (currentQueryId !== queryId) return
    patchSurface(ref, { view: { rowAction: progress } })
  }
  const snapshot = (): RowActionProgress => ({
    verb: verb,
    done: done,
    total: total,
    cancellable: onCancel !== undefined,
    visible: visible,
  })
  if (onCancel) rowActionCancels.set(actionKey, onCancel)
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
      const isOwnCancelHandler = rowActionCancels.get(actionKey) === onCancel
      if (isOwnCancelHandler) rowActionCancels.delete(actionKey)
      patchProgress(null)
      return visible
    },
  }
}

export function cancelRowAction(ref: DataViewSurfaceRef) {
  const actionKey = rowActionKeyOf(ref)
  const cancel = rowActionCancels.get(actionKey)
  if (!cancel) return
  rowActionCancels.delete(actionKey)
  cancel()
}

export function rowActionProgressActions() {
  return { beginRowAction, cancelRowAction }
}
