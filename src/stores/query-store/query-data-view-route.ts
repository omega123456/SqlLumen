import { registerDataViewRoute, type DataViewSelector } from '../data-view/route-registry'
import type { DataViewSurfaceRef } from '../data-view/data-view-types'
import { useQueryStore } from '../query-store'
import { markTabResultsExpired, patchSurface, resultOf } from './query-store-access'
import {
  latestRequestedSpec,
  paintView,
  requestView,
  retryRequestedView,
} from './result-view-requests'
import { rerunResultAfterInsert } from './row-save-rerun'
import { editTargetBlobTable } from '../data-view/stored-blobs'

function useQueryView<Selected>(
  ref: DataViewSurfaceRef,
  selector: DataViewSelector<Selected>
): Selected {
  return useQueryStore((state) => selector(state.tabs[ref.tabId]?.results[ref.resultIndex]?.view))
}

function latestKnownViewVersion(ref: DataViewSurfaceRef): number {
  return resultOf(ref)?.latestKnownViewVersion ?? 0
}

export function registerQueryDataViewRoute() {
  registerDataViewRoute({
    kind: 'query',
    binding: {
      read: (ref) => resultOf(ref)?.view,
      update: (ref, patch) => patchSurface(ref, { view: patch }),
      useView: useQueryView,
    },
    viewRequests: {
      apply: requestView,
      retry: retryRequestedView,
      latestRequested: latestRequestedSpec,
      latestKnownVersion: latestKnownViewVersion,
      paint: paintView,
    },
    writes: {
      cellProjection: 'full',
      afterInsert: rerunResultAfterInsert,
      staleResultAdvice: 'Re-run the query to refresh.',
    },
    lifecycle: {
      onExpired: (ref) => markTabResultsExpired(ref.tabId),
    },
    blobs: {
      storedTable: (ref) => editTargetBlobTable(resultOf(ref)?.view),
    },
  })
}
