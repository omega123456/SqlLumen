import { useEffect, useMemo, useState } from 'react'
import { logFrontend } from '../../../lib/app-log-commands'
import {
  getLoadedRow,
  isResultsExpiredError,
  readViewRange,
  subscribeToResultWindow,
  subscribeToRowPatches,
  type CachedRow,
} from '../../../lib/result-window-cache'
import { useQueryStore } from '../../../stores/query-store'
import { toErrorMessage } from '../../../lib/error-message'
import {
  fetchedRowFor,
  patchFetchedRow,
  type FetchedRow,
  type FormRowPosition,
  type ResultFormViewProps,
} from './result-form-model'

const DRAFT_BASE_INDEX = -1

interface ResultSurface {
  tabId: string
  resultIndex: number
}

function useWindowTick({ tabId, resultIndex }: ResultSurface, clampedIndex: number): number {
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

function usePatchedFetchedRow({ tabId, resultIndex }: ResultSurface) {
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
  surface: ResultSurface
  clampedIndex: number
  fetchKey: string
  needsFetch: boolean
}

function useFetchRowOutsideWindow(fetch: RowFetch) {
  const { surface, clampedIndex, fetchKey, needsFetch } = fetch
  const { tabId, resultIndex } = surface
  const markResultsExpired = useQueryStore((state) => state.markResultsExpired)
  const { fetched, setFetched } = usePatchedFetchedRow(surface)

  useEffect(() => {
    if (!needsFetch) return
    if (fetched?.key === fetchKey) return
    let cancelled = false
    const handleFailure = (error: unknown) => {
      if (cancelled) return
      if (isResultsExpiredError(error)) {
        markResultsExpired(tabId)
        return
      }
      logFrontend(
        'warn',
        `[result-form-view] could not load row ${clampedIndex + 1}: ${toErrorMessage(error)}`
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
  }, [
    clampedIndex,
    fetchKey,
    fetched,
    markResultsExpired,
    needsFetch,
    resultIndex,
    tabId,
    setFetched,
  ])

  return fetched
}

export function useFormCurrentRow(props: ResultFormViewProps, position: FormRowPosition) {
  const { tabId, resultIndex, queryId, viewVersion } = props
  const { clampedIndex, isDraftPosition, totalRows } = position
  const draftRow = props.draftRow ?? null
  const surface = useMemo(() => ({ tabId, resultIndex }), [tabId, resultIndex])
  const windowTick = useWindowTick(surface, clampedIndex)
  const fetchKey = `${queryId ?? ''}:${viewVersion}:${clampedIndex}`

  const loadedRow = useMemo(() => {
    void windowTick
    if (isDraftPosition) return null
    if (totalRows === 0) return null
    return getLoadedRow(tabId, resultIndex, clampedIndex) ?? null
  }, [clampedIndex, isDraftPosition, resultIndex, tabId, totalRows, windowTick])
  const needsFetch = !isDraftPosition && totalRows > 0 && loadedRow === null
  const fetched = useFetchRowOutsideWindow({
    surface: surface,
    clampedIndex: clampedIndex,
    fetchKey: fetchKey,
    needsFetch: needsFetch,
  })

  return useMemo<CachedRow | null>(() => {
    const showsDraftRow = isDraftPosition && draftRow
    if (showsDraftRow) return { row: draftRow, baseIndex: DRAFT_BASE_INDEX }
    return loadedRow ?? fetchedRowFor(fetched, fetchKey)
  }, [draftRow, fetchKey, fetched, isDraftPosition, loadedRow])
}
