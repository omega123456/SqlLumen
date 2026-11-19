import { DEFAULT_DATA_VIEW_STATE } from './data-view-defaults'
import type { DataViewState, DataViewSurfaceRef } from './data-view-types'
import { routeOf } from './route-registry'

export function useDataView<Selected>(
  ref: DataViewSurfaceRef,
  selector: (view: DataViewState) => Selected
): Selected {
  return routeOf(ref).binding.useView(ref, (view) => selector(view ?? DEFAULT_DATA_VIEW_STATE))
}

export function currentView(ref: DataViewSurfaceRef): DataViewState {
  return routeOf(ref).binding.read(ref) ?? DEFAULT_DATA_VIEW_STATE
}
