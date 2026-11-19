import { RESULT_LOADING_STATUS_DELAY_MS } from '../../lib/result-window-cache'
import type { DataViewSurfaceRef, RowActionProgress, RowActionVerb } from './data-view-types'
import { readView, surfaceKeyOf, updateView } from './route-registry'

export interface RowActionStart {
  verb: RowActionVerb
  total: number
  onCancel?: () => void
}

export interface RowActionHandle {
  update: (done: number) => void
  finish: () => boolean
}

const rowActionCancels = new Map<string, () => void>()

function tabKeyPrefixOf(ref: Pick<DataViewSurfaceRef, 'route' | 'tabId'>): string {
  return `${ref.route}:${ref.tabId}:`
}

export function dropRowActionCancels(ref: Pick<DataViewSurfaceRef, 'route' | 'tabId'>) {
  const prefix = tabKeyPrefixOf(ref)
  for (const key of rowActionCancels.keys()) {
    if (key.startsWith(prefix)) rowActionCancels.delete(key)
  }
}

export function beginRowAction(
  ref: DataViewSurfaceRef,
  { verb, total, onCancel }: RowActionStart
): RowActionHandle {
  const actionKey = surfaceKeyOf(ref)
  const queryId = readView(ref)?.slot.queryId ?? null
  let done = 0
  let visible = false
  let finished = false
  const patchProgress = (progress: RowActionProgress | null) => {
    const currentQueryId = readView(ref)?.slot.queryId
    if (currentQueryId !== queryId) return
    updateView(ref, { rowAction: progress })
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
  const actionKey = surfaceKeyOf(ref)
  const cancel = rowActionCancels.get(actionKey)
  if (!cancel) return
  rowActionCancels.delete(actionKey)
  cancel()
}
