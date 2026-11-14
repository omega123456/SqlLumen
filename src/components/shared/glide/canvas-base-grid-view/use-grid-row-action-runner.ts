import { useCallback } from 'react'
import type { GridRowSource, RowRange } from '../grid-row-source'
import type { GridRow, GridRowActions, GridRowActionVerb, RowLookup } from './canvas-grid-types'
import {
  finishRowProgress,
  reportRowActionLoadFailure,
  showRowActionSuccess,
} from './grid-row-action-feedback'
import {
  countFetchChunks,
  countRows,
  hasUnloadedRange,
  loadRowRanges,
  mergeRowRanges,
  type MutableRowRange,
} from './grid-row-ranges'
import type { GridActionRefs, GridViewModel } from './grid-view-model'

export type RowActionBody = (rowAt: RowLookup) => boolean | Promise<boolean>
export type RowActionRunner = (
  verb: GridRowActionVerb,
  ranges: readonly RowRange[],
  act: RowActionBody
) => Promise<boolean>

interface FetchingRowActionRequest {
  verb: GridRowActionVerb
  ranges: MutableRowRange[]
  act: RowActionBody
  source: GridRowSource<GridRow>
  rowActions: GridRowActions | undefined
  actionRefs: GridActionRefs
}

function beginPendingAction(actionRefs: GridActionRefs, controller: AbortController): void {
  actionRefs.actionPendingRef.current = true
  actionRefs.actionAbortRef.current = controller
}

function releasePendingAction(actionRefs: GridActionRefs): void {
  actionRefs.actionPendingRef.current = false
  actionRefs.actionAbortRef.current = null
}

async function runFetchingRowAction(request: FetchingRowActionRequest): Promise<boolean> {
  const { verb, ranges, source, rowActions, actionRefs } = request
  const total = countRows(ranges)
  const controller = new AbortController()
  const spansSeveralFetches = countFetchChunks(ranges) > 1
  const cancelFetch = spansSeveralFetches ? () => controller.abort() : undefined
  beginPendingAction(actionRefs, controller)
  const progress = rowActions?.begin(verb, total, cancelFetch)
  let resolved: Map<number, GridRow>
  try {
    resolved = await loadRowRanges({
      source: source,
      ranges: ranges,
      signal: controller.signal,
      progress: progress,
    })
  } catch (error) {
    finishRowProgress(progress)
    releasePendingAction(actionRefs)
    reportRowActionLoadFailure(verb, error, rowActions)
    return false
  }
  releasePendingAction(actionRefs)
  const wasVisible = finishRowProgress(progress)
  const ok = await request.act((index) => resolved.get(index) ?? source.getRow(index))
  if (ok && wasVisible) showRowActionSuccess(verb, total)
  return ok
}

export function useGridRowActionRunner(model: GridViewModel): RowActionRunner {
  const { isWindowed, rowCount, source } = model
  const { rowActions } = model.props
  const actionRefs = model.refs.action
  return useCallback(
    async (verb, ranges, act) => {
      const merged = mergeRowRanges(ranges, rowCount)
      const needsFetch = isWindowed && hasUnloadedRange(source, merged)
      if (!needsFetch) return act((index) => source.getRow(index))
      return runFetchingRowAction({
        verb: verb,
        ranges: merged,
        act: act,
        source: source,
        rowActions: rowActions,
        actionRefs: actionRefs,
      })
    },
    [actionRefs, isWindowed, rowActions, rowCount, source]
  )
}
