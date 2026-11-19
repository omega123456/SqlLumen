/**
 * Test-only bridge between the flat result field names older tests use
 * (`selectedRowIndex`, `checkedRanges`, `editState`, …) and the nested
 * `view: DataViewState` of `SingleResultState`.
 */
import { DEFAULT_RESULT_STATE, getActiveResult } from '../../stores/query-store'
import type { ResultPatch, SingleResultState, TabQueryState } from '../../stores/query-store'
import { patchedResult } from '../../stores/query-store/query-tab-reducers'
import type { DataViewPatch, DataViewState } from '../../stores/data-view/data-view-types'
import { mergeViewPatches } from '../../stores/data-view/data-view-reducers'

type ViewGroup = keyof DataViewState

const LEGACY_VIEW_FIELDS: Record<string, readonly [ViewGroup, string | null]> = {
  viewMode: ['mode', null],
  columns: ['slot', 'columns'],
  queryId: ['slot', 'queryId'],
  viewVersion: ['slot', 'viewVersion'],
  viewRowCount: ['slot', 'viewRowCount'],
  totalRows: ['slot', 'totalRows'],
  editConnectionId: ['slot', 'connectionId'],
  selectedRowIndex: ['selection', 'rowIndex'],
  selectedCell: ['selection', 'cell'],
  checkedRanges: ['checked', 'ranges'],
  checkedViewVersion: ['checked', 'viewVersion'],
  scrollRow: ['layout', 'scrollRow'],
  scrollCol: ['layout', 'scrollCol'],
  columnWidths: ['layout', 'columnWidths'],
  filterModel: ['spec', 'filters'],
  viewError: ['spec', 'error'],
  pendingWindowRange: ['window', 'pendingRange'],
  failedWindowRange: ['window', 'failedRange'],
  editState: ['edit', 'state'],
  editingRowIndex: ['edit', 'rowIndex'],
  editingBaseIndex: ['edit', 'baseIndex'],
  draftRow: ['edit', 'draftRow'],
  saveError: ['edit', 'saveError'],
  isStale: ['edit', 'isStale'],
  editMode: ['editTarget', 'tableName'],
  editTableMetadata: ['editTarget', 'tables'],
  editForeignKeys: ['editTarget', 'foreignKeys'],
  editableColumnMap: ['editTarget', 'editableColumns'],
  editColumnBindings: ['editTarget', 'bindings'],
  editBoundColumnIndexMap: ['editTarget', 'boundIndexByName'],
  rowResidency: ['residency', 'rows'],
  rowsEvictedAt: ['residency', 'evictedAt'],
  isExpired: ['residency', 'isExpired'],
  exportDialogOpen: ['prompts', 'isExportOpen'],
  preferredExportScope: ['prompts', 'exportScope'],
  pendingNavigationAction: ['prompts', 'pendingNavigation'],
  rowActionProgress: ['rowAction', null],
}

export const PENDING_ROWS = Symbol('pendingRows')

function addToViewPatch(viewPatch: Record<string, unknown>, key: string, value: unknown) {
  const [group, field] = LEGACY_VIEW_FIELDS[key]
  if (field === null) {
    viewPatch[group] = value
    return
  }
  viewPatch[group] = { ...(viewPatch[group] as object | undefined), [field]: value }
}

function addSpecField(viewPatch: Record<string, unknown>, flat: Record<string, unknown>) {
  const spec = { ...(viewPatch.spec as object | undefined) } as Record<string, unknown>
  if ('sortColumn' in flat || 'sortDirection' in flat) {
    const column = flat.sortColumn as string | null | undefined
    const direction = flat.sortDirection as 'asc' | 'desc' | null | undefined
    spec.sort = column && direction ? { column: column, direction: direction } : null
  }
  if (flat.isSorting === true) spec.applying = 'sort'
  if (flat.isFiltering === true) spec.applying = 'filter'
  if (flat.isSorting === false && flat.isFiltering !== true) spec.applying ??= null
  if (Object.keys(spec).length > 0) viewPatch.spec = spec
}

const SPEC_KEYS = new Set(['sortColumn', 'sortDirection', 'isSorting', 'isFiltering'])

export function toResultPatch(flatFields: object): ResultPatch {
  const flat = flatFields as Record<string, unknown>
  const fields: Record<string, unknown> = {}
  const viewPatch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(flat)) {
    if (key in LEGACY_VIEW_FIELDS) addToViewPatch(viewPatch, key, value)
    else if (!SPEC_KEYS.has(key) && key !== 'view') fields[key] = value
  }
  addSpecField(viewPatch, flat)
  const nestedView = (flat.view ?? {}) as DataViewPatch
  return { ...fields, view: mergeViewPatches(nestedView, viewPatch as DataViewPatch) }
}

function withPendingRows<T extends object>(target: T, source: object): T {
  const rows = (source as Record<symbol, unknown>)[PENDING_ROWS]
  if (rows) (target as Record<symbol, unknown>)[PENDING_ROWS] = rows
  return target
}

function isResultState(value: object): value is SingleResultState {
  return 'view' in value && 'resultStatus' in value
}

export function patchedLegacyResult(base: object, flat: object): SingleResultState {
  if (!isResultState(base)) return resultState({ ...base, ...flat })
  return withPendingRows(patchedResult(base, toResultPatch(flat)), flat)
}

export function resultState(flat: object = {}): SingleResultState {
  return withPendingRows(patchedResult(DEFAULT_RESULT_STATE, toResultPatch(flat)), flat)
}

export interface LegacyResultFields {
  viewMode: DataViewState['mode']
  columns: DataViewState['slot']['columns']
  queryId: string | null
  viewVersion: number
  viewRowCount: number
  totalRows: number
  editConnectionId: string
  selectedRowIndex: number | null
  selectedCell: DataViewState['selection']['cell']
  checkedRanges: DataViewState['checked']['ranges']
  checkedViewVersion: number
  scrollRow: number
  scrollCol: number
  columnWidths: Record<string, number>
  sortColumn: string | null
  sortDirection: 'asc' | 'desc' | null
  filterModel: DataViewState['spec']['filters']
  isSorting: boolean
  isFiltering: boolean
  viewError: string | null
  pendingWindowRange: DataViewState['window']['pendingRange']
  failedWindowRange: DataViewState['window']['failedRange']
  editState: DataViewState['edit']['state']
  editingRowIndex: number | null
  editingBaseIndex: number | null
  draftRow: unknown[] | null
  saveError: string | null
  isStale: boolean
  editMode: string | null
  editTableMetadata: DataViewState['editTarget']['tables']
  editForeignKeys: DataViewState['editTarget']['foreignKeys']
  editableColumnMap: Map<number, boolean>
  editColumnBindings: Map<number, string>
  editBoundColumnIndexMap: Map<string, number>
  rowResidency: DataViewState['residency']['rows']
  rowsEvictedAt: number | null
  isExpired: boolean
  exportDialogOpen: boolean
  preferredExportScope: DataViewState['prompts']['exportScope']
  pendingNavigationAction: (() => void) | null
  rowActionProgress: DataViewState['rowAction']
}

export function legacyTabFields(tab: TabQueryState | undefined): LegacyResultFields {
  return legacyFieldsOf(getActiveResult(tab))
}

export function legacyFieldsOf(result: SingleResultState): LegacyResultFields {
  const { view } = result
  return {
    viewMode: view.mode,
    columns: view.slot.columns,
    queryId: view.slot.queryId,
    viewVersion: view.slot.viewVersion,
    viewRowCount: view.slot.viewRowCount,
    totalRows: view.slot.totalRows,
    editConnectionId: view.slot.connectionId,
    selectedRowIndex: view.selection.rowIndex,
    selectedCell: view.selection.cell,
    checkedRanges: view.checked.ranges,
    checkedViewVersion: view.checked.viewVersion,
    scrollRow: view.layout.scrollRow,
    scrollCol: view.layout.scrollCol,
    columnWidths: view.layout.columnWidths,
    sortColumn: view.spec.sort?.column ?? null,
    sortDirection: view.spec.sort?.direction ?? null,
    filterModel: view.spec.filters,
    isSorting: view.spec.applying === 'sort',
    isFiltering: view.spec.applying === 'filter',
    viewError: view.spec.error,
    pendingWindowRange: view.window.pendingRange,
    failedWindowRange: view.window.failedRange,
    editState: view.edit.state,
    editingRowIndex: view.edit.rowIndex,
    editingBaseIndex: view.edit.baseIndex,
    draftRow: view.edit.draftRow,
    saveError: view.edit.saveError,
    isStale: view.edit.isStale,
    editMode: view.editTarget.tableName,
    editTableMetadata: view.editTarget.tables,
    editForeignKeys: view.editTarget.foreignKeys,
    editableColumnMap: view.editTarget.editableColumns,
    editColumnBindings: view.editTarget.bindings,
    editBoundColumnIndexMap: view.editTarget.boundIndexByName,
    rowResidency: view.residency.rows,
    rowsEvictedAt: view.residency.evictedAt,
    isExpired: view.residency.isExpired,
    exportDialogOpen: view.prompts.isExportOpen,
    preferredExportScope: view.prompts.exportScope,
    pendingNavigationAction: view.prompts.pendingNavigation,
    rowActionProgress: view.rowAction,
  }
}
