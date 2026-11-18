import type { TableDataColumnMeta } from '../types/schema'

export const GENERATED_VALUE_PLACEHOLDER = 'Generated on save'

export function isGeneratedColumn(column: TableDataColumnMeta | undefined): boolean {
  return column?.isGenerated === true
}

export function isInlineEditableColumn(column: TableDataColumnMeta): boolean {
  if (column.isBinary) return false
  return !isGeneratedColumn(column)
}
