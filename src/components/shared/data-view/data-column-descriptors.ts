import { useMemo } from 'react'
import {
  resolveQueryResultColumns,
  type ResolvedQueryResultColumn,
} from '../../../lib/query-result-column-utils'
import type { ColumnMeta, ForeignKeyColumnInfo, TableDataColumnMeta } from '../../../types/schema'
import type { GridColumnDescriptor } from '../../../types/shared-data-view'
import type { DataViewEditTarget } from '../../../stores/data-view/data-view-types'
import { buildGridColumnDescriptor } from './grid-column-descriptor'
import type { DataColumnMetadata } from './data-view-source'

const NO_TABLE_COLUMNS: TableDataColumnMeta[] = []

export interface DataColumnContext {
  isEditing: boolean
  editColumnBindings: Map<number, string>
  columnWidths?: Record<string, number>
}

export function toDataColumnDescriptor(
  column: ResolvedQueryResultColumn,
  columnIndex: number,
  context: DataColumnContext
): GridColumnDescriptor {
  const isBoundForEdit = context.isEditing && context.editColumnBindings.has(columnIndex)
  return buildGridColumnDescriptor({
    key: column.key,
    displayName: column.displayName,
    dataType: column.dataType,
    tableColumn: column.tableColumnMeta,
    foreignKey: column.foreignKey,
    editable: column.editable,
    blobViewerEditable: isBoundForEdit,
    width: context.columnWidths?.[column.key],
  })
}

export function editTableColumnsOf(editTarget: DataViewEditTarget): TableDataColumnMeta[] {
  const tableName = editTarget.tableName
  if (!tableName) return NO_TABLE_COLUMNS
  return editTarget.tables[tableName]?.columns ?? NO_TABLE_COLUMNS
}

export interface DataColumnDescriptorInputs {
  columns: ColumnMeta[]
  editTarget: DataViewEditTarget
  metadata: DataColumnMetadata | null
  columnWidths?: Record<string, number>
}

export interface DescriptorMetadata {
  tableColumns: TableDataColumnMeta[]
  foreignKeys: ForeignKeyColumnInfo[]
  bindings: Map<number, string>
}

function editTargetMetadataOf(editTarget: DataViewEditTarget): DescriptorMetadata {
  return {
    tableColumns: editTableColumnsOf(editTarget),
    foreignKeys: editTarget.foreignKeys,
    bindings: editTarget.bindings,
  }
}

function identityBindingsOf(columns: ColumnMeta[]): Map<number, string> {
  return new Map(columns.map((column, columnIndex) => [columnIndex, column.name]))
}

export function descriptorMetadataOf({
  columns,
  editTarget,
  metadata,
}: DataColumnDescriptorInputs): DescriptorMetadata {
  if (editTarget.tableName !== null) return editTargetMetadataOf(editTarget)
  if (!metadata) return editTargetMetadataOf(editTarget)
  return {
    tableColumns: metadata.tableColumns,
    foreignKeys: metadata.foreignKeys,
    bindings: identityBindingsOf(columns),
  }
}

export function useDataColumnDescriptors(inputs: DataColumnDescriptorInputs) {
  const { columns, editTarget, metadata, columnWidths } = inputs
  const resolvedColumns = useMemo(() => {
    const descriptorMetadata = descriptorMetadataOf({
      columns: columns,
      editTarget: editTarget,
      metadata: metadata,
    })
    return resolveQueryResultColumns({
      resultColumns: columns,
      editMode: editTarget.tableName,
      editableColumnMap: editTarget.editableColumns,
      editTableColumns: descriptorMetadata.tableColumns,
      editForeignKeys: descriptorMetadata.foreignKeys,
      editColumnBindings: descriptorMetadata.bindings,
    })
  }, [columns, editTarget, metadata])

  const descriptors: GridColumnDescriptor[] = useMemo(() => {
    const context = {
      isEditing: editTarget.tableName !== null,
      editColumnBindings: editTarget.bindings,
      columnWidths: columnWidths,
    }
    return resolvedColumns.map((column, columnIndex) =>
      toDataColumnDescriptor(column, columnIndex, context)
    )
  }, [columnWidths, editTarget, resolvedColumns])

  return { resolvedColumns, descriptors }
}
