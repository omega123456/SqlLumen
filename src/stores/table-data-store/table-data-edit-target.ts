import type { QueryTableEditInfo, TableDataColumnMeta } from '../../types/schema'
import { isInlineEditableColumn } from '../../lib/column-capabilities'
import { buildBoundColumnIndexMap } from '../../lib/query-edit-utils'
import { useConnectionStore } from '../connection-store'
import { DEFAULT_EDIT_TARGET } from '../data-view/data-view-defaults'
import type { DataViewEditTarget } from '../data-view/data-view-types'
import type { TableDataMeta, TableDataSource } from './table-data-tab-state'

function isConnectionReadOnly(connectionId: string): boolean {
  return useConnectionStore.getState().activeConnections[connectionId]?.profile?.readOnly ?? false
}

export function tableEditKeyOf(table: TableDataSource): string {
  return `${table.database}.${table.table}`
}

export function tableEditInfoOf(table: TableDataSource, meta: TableDataMeta): QueryTableEditInfo {
  return {
    database: table.database,
    table: table.table,
    columns: meta.columns,
    primaryKey: meta.primaryKey,
  }
}

function canEditTable(table: TableDataSource, meta: TableDataMeta): boolean {
  if (table.isView) return false
  if (meta.primaryKey === null) return false
  return !isConnectionReadOnly(table.connectionId)
}

function identityBindingsOf(columns: TableDataColumnMeta[]): Map<number, string> {
  return new Map(columns.map((column, columnIndex) => [columnIndex, column.name]))
}

function editableColumnsOf(columns: TableDataColumnMeta[]): Map<number, boolean> {
  return new Map(
    columns.map((column, columnIndex) => [columnIndex, isInlineEditableColumn(column)])
  )
}

export function tableEditTargetOf(table: TableDataSource, meta: TableDataMeta): DataViewEditTarget {
  if (!canEditTable(table, meta)) return DEFAULT_EDIT_TARGET
  const bindings = identityBindingsOf(meta.columns)
  const tableKey = tableEditKeyOf(table)
  return {
    tableName: tableKey,
    tables: { [tableKey]: tableEditInfoOf(table, meta) },
    foreignKeys: meta.foreignKeys,
    editableColumns: editableColumnsOf(meta.columns),
    bindings: bindings,
    boundIndexByName: buildBoundColumnIndexMap(bindings),
  }
}
