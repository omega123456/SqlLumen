import {
  DEFAULT_RESULT_STATE,
  useQueryStore,
  type SingleResultState,
} from '../../stores/query-store'
import type { DataViewSurfaceRef } from '../../stores/data-view/data-view-types'

export function useQuerySurfaceResult(surfaceRef: DataViewSurfaceRef): SingleResultState {
  return useQueryStore(
    (state) => state.tabs[surfaceRef.tabId]?.results[surfaceRef.resultIndex] ?? DEFAULT_RESULT_STATE
  )
}
