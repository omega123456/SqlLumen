import {
  clampLengthForType,
  getDefaultLengthForType,
  normalizeTypeModifier,
} from '../../components/table-designer/table-designer-type-constants'
import { isIndexInBounds, isNonEmptyList } from '../../lib/value-checks'
import type {
  TableDesignerColumnDef,
  TableDesignerForeignKeyDef,
  TableDesignerIndexDef,
  TableDesignerProperties,
  TableDesignerSchema,
} from '../../types/schema'
import type { DesignerFieldEdit, TableDesignerTabState } from '../table-designer-store'
import { cloneValue } from './designer-schema'
import {
  mergeColumnAndIndexValidationErrors,
  mergeIndexValidationErrors,
  mergeTableNameValidationError,
  type ValidationErrors,
} from './designer-validation'

export interface SchemaEdit {
  schema: TableDesignerSchema
  validationErrors?: ValidationErrors
}

export interface ColumnMove {
  fromIndex: number
  toIndex: number
}

export interface PropertyEdit {
  field: keyof TableDesignerProperties
  value: unknown
}

const AUTO_INCREMENT_CAPABLE_TYPE =
  /^(INT|TINYINT|SMALLINT|MEDIUMINT|BIGINT|DECIMAL|FLOAT|DOUBLE|BIT|BOOLEAN)$/i

interface PreviousColumnIdentity {
  type: string
  name: string
}

interface ColumnFieldChange {
  schema: TableDesignerSchema
  column: TableDesignerColumnDef
  previous: PreviousColumnIdentity
  text: string
}

function fieldValueAsText(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

function canKeepAutoIncrement(column: TableDesignerColumnDef): boolean {
  if (!column.isPrimaryKey) return false
  return AUTO_INCREMENT_CAPABLE_TYPE.test(column.type.trim())
}

function applyColumnTypeChange({ column, previous, text }: ColumnFieldChange): void {
  column.type = text
  column.length =
    text === previous.type ? clampLengthForType(text, column.length) : getDefaultLengthForType(text)
  column.typeModifier = normalizeTypeModifier(text, column.typeModifier)
  const mustDropAutoIncrement = column.isAutoIncrement && !canKeepAutoIncrement(column)
  if (mustDropAutoIncrement) {
    column.isAutoIncrement = false
  }
}

function applyColumnLengthChange({ column, text }: ColumnFieldChange): void {
  column.length = clampLengthForType(column.type, text)
}

function applyColumnTypeModifierChange({ column, text }: ColumnFieldChange): void {
  column.typeModifier = normalizeTypeModifier(column.type, text)
}

function applyColumnRename({ schema, column, previous, text }: ColumnFieldChange): void {
  const renameColumn = (name: string) => (name === previous.name ? text : name)
  column.name = text
  schema.indexes = schema.indexes.map((index) => ({
    ...index,
    columns: index.columns.map(renameColumn),
  }))
  schema.foreignKeys = schema.foreignKeys.map((foreignKey) => ({
    ...foreignKey,
    sourceColumn: renameColumn(foreignKey.sourceColumn),
  }))
}

const COLUMN_FIELD_NORMALIZERS: Partial<
  Record<keyof TableDesignerColumnDef, (change: ColumnFieldChange) => void>
> = {
  type: applyColumnTypeChange,
  length: applyColumnLengthChange,
  typeModifier: applyColumnTypeModifierChange,
  name: applyColumnRename,
}

function columnEditResult(tab: TableDesignerTabState, schema: TableDesignerSchema): SchemaEdit {
  return {
    schema: schema,
    validationErrors: mergeColumnAndIndexValidationErrors(tab.validationErrors, schema),
  }
}

function indexEditResult(tab: TableDesignerTabState, schema: TableDesignerSchema): SchemaEdit {
  return {
    schema: schema,
    validationErrors: mergeIndexValidationErrors(tab.validationErrors, schema.indexes),
  }
}

function blankColumn(): TableDesignerColumnDef {
  return {
    name: '',
    type: 'VARCHAR',
    length: getDefaultLengthForType('VARCHAR'),
    nullable: true,
    isPrimaryKey: false,
    isAutoIncrement: false,
    defaultValue: { tag: 'NO_DEFAULT' },
    comment: '',
    originalName: '',
  }
}

function blankForeignKey(databaseName: string): TableDesignerForeignKeyDef {
  return {
    name: '',
    sourceColumn: '',
    referencedDatabase: databaseName,
    referencedTable: '',
    referencedColumn: '',
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
    isComposite: false,
  }
}

function withoutColumnReferences(
  schema: TableDesignerSchema,
  removedColumnName: string
): TableDesignerSchema {
  const indexes = schema.indexes
    .map((index) => ({
      ...index,
      columns: index.columns.filter((name) => name !== removedColumnName),
    }))
    .filter((index) => isNonEmptyList(index.columns))
  const foreignKeys = schema.foreignKeys.filter(
    (foreignKey) => foreignKey.sourceColumn !== removedColumnName
  )
  return { ...schema, indexes: indexes, foreignKeys: foreignKeys }
}

function isValidColumnMove(columns: TableDesignerColumnDef[], move: ColumnMove): boolean {
  return (
    isIndexInBounds(move.fromIndex, columns.length) &&
    isIndexInBounds(move.toIndex, columns.length) &&
    move.fromIndex !== move.toIndex
  )
}

export function editColumnField(
  tab: TableDesignerTabState,
  { index: columnIndex, field, value }: DesignerFieldEdit<TableDesignerColumnDef>
): SchemaEdit | null {
  if (!isIndexInBounds(columnIndex, tab.currentSchema.columns.length)) return null

  const schema = cloneValue(tab.currentSchema)
  const column = schema.columns[columnIndex]
  const previous: PreviousColumnIdentity = { type: column.type, name: column.name }

  ;(column[field] as unknown) = value

  COLUMN_FIELD_NORMALIZERS[field]?.({
    schema: schema,
    column: column,
    previous: previous,
    text: fieldValueAsText(value),
  })

  return columnEditResult(tab, schema)
}

export function addBlankColumn(tab: TableDesignerTabState): SchemaEdit {
  const schema = cloneValue(tab.currentSchema)
  schema.columns.push(blankColumn())
  return columnEditResult(tab, schema)
}

export function removeColumn(tab: TableDesignerTabState, columnIndex: number): SchemaEdit | null {
  if (!isIndexInBounds(columnIndex, tab.currentSchema.columns.length)) return null

  const schema = cloneValue(tab.currentSchema)
  const [removedColumn] = schema.columns.splice(columnIndex, 1)
  if (!removedColumn) return null

  return columnEditResult(tab, withoutColumnReferences(schema, removedColumn.name))
}

export function moveColumn(tab: TableDesignerTabState, move: ColumnMove): SchemaEdit | null {
  if (!isValidColumnMove(tab.currentSchema.columns, move)) return null

  const schema = cloneValue(tab.currentSchema)
  const [moved] = schema.columns.splice(move.fromIndex, 1)
  if (!moved) return null

  schema.columns.splice(move.toIndex, 0, moved)
  return columnEditResult(tab, schema)
}

export function editIndexField(
  tab: TableDesignerTabState,
  { index: indexPosition, field, value }: DesignerFieldEdit<TableDesignerIndexDef>
): SchemaEdit | null {
  if (!isIndexInBounds(indexPosition, tab.currentSchema.indexes.length)) return null

  const schema = cloneValue(tab.currentSchema)
  ;(schema.indexes[indexPosition][field] as unknown) = value
  return indexEditResult(tab, schema)
}

export function addBlankIndex(tab: TableDesignerTabState): SchemaEdit {
  const schema = cloneValue(tab.currentSchema)
  schema.indexes.push({ name: '', indexType: 'INDEX', columns: [] })
  return indexEditResult(tab, schema)
}

export function removeIndex(tab: TableDesignerTabState, indexPosition: number): SchemaEdit | null {
  if (!isIndexInBounds(indexPosition, tab.currentSchema.indexes.length)) return null

  const schema = cloneValue(tab.currentSchema)
  schema.indexes.splice(indexPosition, 1)
  return indexEditResult(tab, schema)
}

export function editForeignKeyField(
  tab: TableDesignerTabState,
  { index: foreignKeyIndex, field, value }: DesignerFieldEdit<TableDesignerForeignKeyDef>
): SchemaEdit | null {
  if (!isIndexInBounds(foreignKeyIndex, tab.currentSchema.foreignKeys.length)) return null

  const schema = cloneValue(tab.currentSchema)
  ;(schema.foreignKeys[foreignKeyIndex][field] as unknown) = value
  return { schema }
}

export function addBlankForeignKey(tab: TableDesignerTabState): SchemaEdit {
  const schema = cloneValue(tab.currentSchema)
  schema.foreignKeys.push(blankForeignKey(tab.databaseName))
  return { schema }
}

export function removeForeignKey(
  tab: TableDesignerTabState,
  foreignKeyIndex: number
): SchemaEdit | null {
  if (!isIndexInBounds(foreignKeyIndex, tab.currentSchema.foreignKeys.length)) return null

  const schema = cloneValue(tab.currentSchema)
  schema.foreignKeys.splice(foreignKeyIndex, 1)
  return { schema }
}

export function editProperty(
  tab: TableDesignerTabState,
  { field, value }: PropertyEdit
): SchemaEdit {
  const schema = cloneValue(tab.currentSchema)
  ;(schema.properties[field] as unknown) = value
  return { schema }
}

export function renameTable(tab: TableDesignerTabState, name: string): SchemaEdit {
  const schema = cloneValue(tab.currentSchema)
  schema.tableName = name
  return {
    schema: schema,
    validationErrors: mergeTableNameValidationError(tab.validationErrors, name),
  }
}
