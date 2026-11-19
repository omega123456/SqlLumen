export type DataViewRouteKind = 'query' | 'table'

export interface DataViewSurfaceRef {
  route: DataViewRouteKind
  tabId: string
  resultIndex: number
}
