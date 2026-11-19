import { registerDataViewRoute } from '../data-view/route-registry'
import type { DataViewSurfaceRef } from '../data-view/data-view-types'
import { markTabResultsExpired, patchSurface, resultOf } from './query-store-access'
import {
  latestRequestedSpec,
  paintView,
  requestView,
  retryRequestedView,
} from './result-view-requests'
import { rerunResultAfterInsert } from './row-save-rerun'

function latestKnownViewVersion(ref: DataViewSurfaceRef): number {
  return resultOf(ref)?.latestKnownViewVersion ?? 0
}

export function registerQueryDataViewRoute() {
  registerDataViewRoute({
    kind: 'query',
    binding: {
      read: (ref) => resultOf(ref)?.view,
      update: (ref, patch) => patchSurface(ref, { view: patch }),
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
    },
    lifecycle: {
      onExpired: (ref) => markTabResultsExpired(ref.tabId),
    },
  })
}
