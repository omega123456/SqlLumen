import type { DataViewSurfaceRef } from '../data-view/data-view-types'
import { getActiveIndex } from './query-store-access'

export function querySurfaceRef(tabId: string, resultIndex: number): DataViewSurfaceRef {
  return { route: 'query', tabId: tabId, resultIndex: resultIndex }
}

export function activeQuerySurfaceRef(tabId: string): DataViewSurfaceRef {
  return querySurfaceRef(tabId, getActiveIndex(tabId))
}
