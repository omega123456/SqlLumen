import {
  AUTO_SIZE_SAMPLE_LIMIT,
  DEFAULT_COLUMN_WIDTH_PX,
  HEADER_ICON_WIDTH_PX,
  getAutoSizedColumnWidth,
} from '../../../lib/grid-column-style'
import type { GridColumnDescriptor, StatusType } from '../../../types/shared-data-view'
import type {
  TableDataColumnMeta,
  TableDataResponse,
  PrimaryKeyInfo,
  FilterCondition,
} from '../../../types/schema'

export const LOOKUP_PAGE_SIZE = 100
const MISSING_ROW_INDEX = -1

export interface LookupSort {
  column: string
  direction: 'ASC' | 'DESC'
}

export type LookupRow = Record<string, unknown>

export function lookupSortRequest(sortInfo: LookupSort | null) {
  if (!sortInfo) return { sortColumn: undefined, sortDirection: undefined }
  return { sortColumn: sortInfo.column, sortDirection: sortInfo.direction.toLowerCase() }
}

export function toLookupRows(response: TableDataResponse): LookupRow[] {
  const columnNames = response.columns.map((column) => column.name)
  return response.rows.map((row, index) => {
    const lookupRow: LookupRow = { __rowIdx: index }
    columnNames.forEach((name, columnIndex) => {
      lookupRow[name] = row[columnIndex] ?? null
    })
    return lookupRow
  })
}

function hasLookupValue(currentValue: unknown): boolean {
  return currentValue !== null && currentValue !== undefined && currentValue !== ''
}

export function initialLookupFilter(
  currentValue: unknown,
  referencedColumn: string
): FilterCondition[] {
  if (!hasLookupValue(currentValue)) return []
  return [{ column: referencedColumn, operator: '==' as const, value: String(currentValue) }]
}

export function resolveLookupSort(
  column: string | null,
  direction: LookupSort['direction'] | null
): LookupSort | null {
  if (!column) return null
  if (!direction) return null
  return { column, direction }
}

export function lookupRowKey(row: LookupRow, primaryKey: PrimaryKeyInfo | null): string {
  const keyColumns = primaryKey?.keyColumns ?? []
  if (keyColumns.length > 0) {
    return JSON.stringify(keyColumns.map((column) => row[column]))
  }
  return String(row['__rowIdx'] ?? MISSING_ROW_INDEX)
}

export function lookupStatus(isLoading: boolean, error: string | null): StatusType {
  if (isLoading) return 'loading'
  if (error !== null) return 'error'
  return 'success'
}

interface ApplyAvailability {
  hasSelection: boolean
  isReadOnly: boolean
  isLoading: boolean
  error: string | null
}

export function isApplyEnabled(availability: ApplyAvailability): boolean {
  if (!availability.hasSelection) return false
  if (availability.isReadOnly) return false
  return !availability.isLoading && !availability.error
}

export interface LookupPageRequest {
  page: number
  size: number
  filters: FilterCondition[]
  sortInfo: LookupSort | null
}

function sampleLookupColumn(rows: LookupRow[], columnKey: string): unknown[][] {
  const sampleCount = Math.min(rows.length, AUTO_SIZE_SAMPLE_LIMIT)
  const columnRows: unknown[][] = new Array(sampleCount)
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    columnRows[sampleIndex] = [rows[sampleIndex][columnKey]]
  }
  return columnRows
}

export function computeLookupColumnWidth(
  columnMetaByName: Map<string, TableDataColumnMeta>,
  rows: LookupRow[],
  column: GridColumnDescriptor
): number {
  const meta = columnMetaByName.get(column.key)
  if (!meta) return DEFAULT_COLUMN_WIDTH_PX
  const showsHeaderIcon = Boolean(column.foreignKey) || !column.editable
  return getAutoSizedColumnWidth({
    column: meta,
    columnIndex: 0,
    rows: sampleLookupColumn(rows, column.key),
    displayName: column.key,
    headerIconWidthPx: showsHeaderIcon ? HEADER_ICON_WIDTH_PX : 0,
  })
}
