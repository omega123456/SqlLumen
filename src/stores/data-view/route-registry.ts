import type { QueryTableEditInfo, ResultViewSpec, ResultWindow } from '../../types/schema'
import type { InsertedColumnValue } from '../../lib/table-data-commands'
import type { CellProjection } from '../../lib/row-write-payloads'
import type {
  DataViewPatch,
  DataViewRouteKind,
  DataViewState,
  DataViewSurfaceRef,
  ViewSpecChange,
} from './data-view-types'

export type DataViewSelector<Selected> = (view: DataViewState | undefined) => Selected

export interface DataViewBinding {
  read: (ref: DataViewSurfaceRef) => DataViewState | undefined
  update: (ref: DataViewSurfaceRef, patch: DataViewPatch) => void
  useView: <Selected>(ref: DataViewSurfaceRef, selector: DataViewSelector<Selected>) => Selected
}

export interface PaintedView {
  viewVersion: number
  viewRowCount: number
  totalRows: number
  window?: ResultWindow
}

export interface ViewPaintRequest {
  spec: ResultViewSpec
  view: PaintedView
  extra?: DataViewPatch
}

export interface ViewSpecRequest {
  spec: ResultViewSpec
  kind: ViewSpecChange
}

export interface DataViewViewRequests {
  apply: (ref: DataViewSurfaceRef, request: ViewSpecRequest) => Promise<void>
  retry: (ref: DataViewSurfaceRef) => void
  latestRequested: (ref: DataViewSurfaceRef) => ResultViewSpec | null
  latestKnownVersion: (ref: DataViewSurfaceRef) => number
  paint: (ref: DataViewSurfaceRef, request: ViewPaintRequest) => void
}

export interface DataViewWrites {
  cellProjection: CellProjection
  afterInsert: (ref: DataViewSurfaceRef, inserted: InsertedColumnValue[]) => Promise<boolean>
  staleResultAdvice: string
}

export interface DataViewLifecycle {
  onExpired: (ref: DataViewSurfaceRef) => void
  onEditClosed?: (ref: DataViewSurfaceRef) => void
}

export interface StoredBlobTable {
  connectionId: string
  tableInfo: QueryTableEditInfo
  boundNameOf: (columnIndex: number) => string | undefined
  columnIndexOf: (columnName: string) => number | undefined
}

export interface DataViewBlobs {
  storedTable: (ref: DataViewSurfaceRef) => StoredBlobTable | null
}

export interface DataViewRoute {
  kind: DataViewRouteKind
  binding: DataViewBinding
  viewRequests: DataViewViewRequests
  writes: DataViewWrites
  lifecycle: DataViewLifecycle
  blobs: DataViewBlobs
}

const routes = new Map<DataViewRouteKind, DataViewRoute>()

export function registerDataViewRoute(route: DataViewRoute): void {
  routes.set(route.kind, route)
}

export function routeOf(ref: Pick<DataViewSurfaceRef, 'route'>): DataViewRoute {
  const route = routes.get(ref.route)
  if (!route) throw new Error(`No data-view route registered for ${ref.route}`)
  return route
}

export function readView(ref: DataViewSurfaceRef): DataViewState | undefined {
  return routeOf(ref).binding.read(ref)
}

export function updateView(ref: DataViewSurfaceRef, patch: DataViewPatch): void {
  routeOf(ref).binding.update(ref, patch)
}

export function isSurfaceOpen(ref: DataViewSurfaceRef): boolean {
  return readView(ref) !== undefined
}

export function surfaceKeyOf(ref: DataViewSurfaceRef): string {
  return `${ref.route}:${ref.tabId}:${ref.resultIndex}`
}
