import { useEffect, useMemo, useState } from 'react'
import { logFrontend } from '../../../../lib/app-log-commands'
import {
  getLoadedRow,
  isResultsExpiredError,
  readViewRange,
  subscribeToResultWindow,
  subscribeToRowPatches,
  type CachedRow,
} from '../../../../lib/result-window-cache'
import { toErrorMessage } from '../../../../lib/error-message'
import type { DataViewSlot, DataViewSurfaceRef } from '../../../../stores/data-view/data-view-types'
import { DRAFT_ROW_BASE_INDEX } from '../../../../stores/data-view/data-view-selectors'
import { routeOf } from '../../../../stores/data-view/route-registry'
import {
  fetchedRowFor,
  patchFetchedRow,
  type FetchedRow,
  type FormRowPosition,
} from './data-form-model'

function useWindowTick({ tabId, resultIndex }: DataViewSurfaceRef, clampedIndex: number): number {
  const [windowTick, setWindowTick] = useState(0)
  useEffect(
    () =>
      subscribeToResultWindow(tabId, resultIndex, ([start, end]) => {
        const isCurrentRowInWindow = clampedIndex >= start && clampedIndex < end
        if (isCurrentRowInWindow) setWindowTick((tick) => tick + 1)
      }),
    [clampedIndex, resultIndex, tabId]
  )
  return windowTick
}

function usePatchedFetchedRow({ tabId, resultIndex }: DataViewSurfaceRef) {
  const [fetched, setFetched] = useState<FetchedRow | null>(null)
  useEffect(
    () =>
      subscribeToRowPatches(tabId, resultIndex, (baseIndex, apply) => {
        setFetched((current) => patchFetchedRow(current, baseIndex, apply))
      }),
    [resultIndex, tabId]
  )
  return { fetched, setFetched }
}

interface RowFetch {
  surface: DataViewSurfaceRef
  clampedIndex: number
  fetchKey: string
  needsFetch: boolean
}

function useFetchRowOutsideWindow(fetch: RowFetch) {
  const { surface, clampedIndex, fetchKey, needsFetch } = fetch
  const { tabId, resultIndex } = surface
  const { fetched, setFetched } = usePatchedFetchedRow(surface)

  useEffect(() => {
    if (!needsFetch) return
    if (fetched?.key === fetchKey) return
    let cancelled = false
    const handleFailure = (error: unknown) => {
      if (cancelled) return
      if (isResultsExpiredError(error)) {
        routeOf(surface).lifecycle.onExpired(surface)
        return
      }
      logFrontend(
        'warn',
        `[data-form-view] could not load row ${clampedIndex + 1}: ${toErrorMessage(error)}`
      )
    }
    readViewRange({
      tabId: tabId,
      resultIndex: resultIndex,
      range: [clampedIndex, clampedIndex + 1],
    })
      .then((rows) => {
        const firstRow = rows[0]
        if (cancelled) return
        if (firstRow) setFetched({ key: fetchKey, row: firstRow })
      })
      .catch(handleFailure)
    return () => {
      cancelled = true
    }
  }, [clampedIndex, fetchKey, fetched, needsFetch, resultIndex, surface, tabId, setFetched])

  return fetched
}

interface FormCurrentRowInputs {
  ref: DataViewSurfaceRef
  slot: DataViewSlot
  draftRow: unknown[] | null
  position: FormRowPosition
}

export function useFormCurrentRow({ ref, slot, draftRow, position }: FormCurrentRowInputs) {
  const { clampedIndex, isDraftPosition, totalRows } = position
  const { tabId, resultIndex } = ref
  const windowTick = useWindowTick(ref, clampedIndex)
  const fetchKey = `${slot.queryId ?? ''}:${slot.viewVersion}:${clampedIndex}`

  const loadedRow = useMemo(() => {
    void windowTick
    if (isDraftPosition) return null
    if (totalRows === 0) return null
    return getLoadedRow(tabId, resultIndex, clampedIndex) ?? null
  }, [clampedIndex, isDraftPosition, resultIndex, tabId, totalRows, windowTick])
  const needsFetch = !isDraftPosition && totalRows > 0 && loadedRow === null
  const fetched = useFetchRowOutsideWindow({
    surface: ref,
    clampedIndex: clampedIndex,
    fetchKey: fetchKey,
    needsFetch: needsFetch,
  })

  return useMemo<CachedRow | null>(() => {
    const showsDraftRow = isDraftPosition && draftRow
    if (showsDraftRow) return { row: draftRow, baseIndex: DRAFT_ROW_BASE_INDEX }
    return loadedRow ?? fetchedRowFor(fetched, fetchKey)
  }, [draftRow, fetchKey, fetched, isDraftPosition, loadedRow])
}
