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
let lastRowActionId = 0

function nextRowActionId(): number {
  lastRowActionId += 1
  return lastRowActionId
}

function isOwnProgress(ref: DataViewSurfaceRef, actionId: number): boolean {
  return readView(ref)?.rowAction?.actionId === actionId
}

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
  const actionId = nextRowActionId()
  let done = 0
  let visible = false
  let finished = false
  const patchOwnProgress = (progress: RowActionProgress | null) => {
    if (!isOwnProgress(ref, actionId)) return
    updateView(ref, { rowAction: progress })
  }
  const snapshot = (): RowActionProgress => ({
    actionId: actionId,
    verb: verb,
    done: done,
    total: total,
    cancellable: onCancel !== undefined,
    visible: visible,
  })
  if (onCancel) rowActionCancels.set(actionKey, onCancel)
  updateView(ref, { rowAction: snapshot() })
  const timer = setTimeout(() => {
    if (finished) return
    visible = true
    patchOwnProgress(snapshot())
  }, RESULT_LOADING_STATUS_DELAY_MS)
  return {
    update: (nextDone: number) => {
      done = nextDone
      const isShowingProgress = visible && !finished
      if (isShowingProgress) patchOwnProgress(snapshot())
    },
    finish: () => {
      finished = true
      clearTimeout(timer)
      const isOwnCancelHandler = rowActionCancels.get(actionKey) === onCancel
      if (isOwnCancelHandler) rowActionCancels.delete(actionKey)
      patchOwnProgress(null)
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
