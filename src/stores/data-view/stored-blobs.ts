import type { BlobValueResponse } from '../../types/schema'
import {
  buildEnvelopedPrimaryKeyPairs,
  type BuildEnvelopedPkPairsResult,
} from '../../lib/blob-utils'
import { fetchBlobValue } from '../../lib/table-data-commands'
import type { DataViewState, DataViewSurfaceRef } from './data-view-types'
import { boundColumnIndexOf, editTableOf } from './data-view-selectors'
import { routeOf, type StoredBlobTable } from './route-registry'

export type CellValueAt = (columnIndex: number) => unknown

export function editTargetBlobTable(view: DataViewState | undefined): StoredBlobTable | null {
  if (!view) return null
  const tableInfo = editTableOf(view)
  if (!tableInfo?.primaryKey) return null
  const { bindings } = view.editTarget
  return {
    connectionId: view.slot.connectionId,
    tableInfo: tableInfo,
    boundNameOf: (columnIndex) => bindings.get(columnIndex),
    columnIndexOf: (columnName) => boundColumnIndexOf(view, columnName),
  }
}

function keyColumnsOf(table: StoredBlobTable): string[] {
  return table.tableInfo.primaryKey?.keyColumns ?? []
}

export function storedBlobKeyPairs(
  table: StoredBlobTable,
  valueAt: CellValueAt
): BuildEnvelopedPkPairsResult {
  const keyColumns = keyColumnsOf(table)
  const keyValues: Record<string, unknown> = {}
  for (const keyColumn of keyColumns) {
    const columnIndex = table.columnIndexOf(keyColumn)
    keyValues[keyColumn] = columnIndex === undefined ? undefined : valueAt(columnIndex)
  }
  return buildEnvelopedPrimaryKeyPairs(keyColumns, table.tableInfo.columns, keyValues)
}

export interface StoredBlobCell {
  columnIndex: number
  valueAt: CellValueAt
}

export type StoredBlobLoad =
  { ok: true; load: () => Promise<BlobValueResponse> } | { ok: false; error: string }

export function storedBlobLoadOf(
  ref: DataViewSurfaceRef,
  { columnIndex, valueAt }: StoredBlobCell
): StoredBlobLoad | null {
  const table = routeOf(ref).blobs.storedTable(ref)
  if (!table) return null
  const columnName = table.boundNameOf(columnIndex)
  if (!columnName) return null
  const primaryKey = storedBlobKeyPairs(table, valueAt)
  if (!primaryKey.ok) return { ok: false, error: primaryKey.error }
  return {
    ok: true,
    load: () =>
      fetchBlobValue({
        connectionId: table.connectionId,
        database: table.tableInfo.database,
        table: table.tableInfo.table,
        column: columnName,
        primaryKeyPairs: primaryKey.pairs,
      }),
  }
}
