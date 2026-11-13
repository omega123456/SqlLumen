import {
  getDefaultLengthForType,
  normalizeTypeModifier,
} from '../../components/table-designer/table-designer-type-constants'
import { isObjectRecord } from '../../lib/value-checks'
import type {
  TableDesignerColumnDef,
  TableDesignerProperties,
  TableDesignerSchema,
} from '../../types/schema'
import type { TableDesignerTabState, TableDesignerTarget } from '../table-designer-store'

const INTEGER_TYPES_WITH_DEFAULT_DISPLAY_LENGTH = new Set([
  'INT',
  'TINYINT',
  'SMALLINT',
  'MEDIUMINT',
  'BIGINT',
])

export function defaultProperties(): TableDesignerProperties {
  return {
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collation: 'utf8mb4_unicode_ci',
    autoIncrement: null,
    rowFormat: 'DEFAULT',
    comment: '',
  }
}

export function createBlankSchema(): TableDesignerSchema {
  return {
    tableName: '',
    columns: [],
    indexes: [],
    foreignKeys: [],
    properties: defaultProperties(),
  }
}

export function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizeForComparison(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForComparison(item))
  }

  if (isObjectRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = normalizeForComparison(value[key])
        return accumulator
      }, {})
  }

  return value
}

function schemasEqual<T>(left: T, right: T): boolean {
  return (
    JSON.stringify(normalizeForComparison(left)) === JSON.stringify(normalizeForComparison(right))
  )
}

function canonicalizeColumn(column: TableDesignerColumnDef): TableDesignerColumnDef {
  const normalizedModifier = normalizeTypeModifier(column.type, column.typeModifier)
  if (normalizedModifier === '') {
    const { typeModifier, ...rest } = column
    void typeModifier
    return rest
  }

  return {
    ...column,
    typeModifier: normalizedModifier,
  }
}

function canonicalizeSchema(schema: TableDesignerSchema): TableDesignerSchema {
  return {
    ...schema,
    columns: schema.columns.map(canonicalizeColumn),
  }
}

function normalizeLoadedColumn(column: TableDesignerColumnDef): TableDesignerColumnDef {
  const hasLength = column.length.trim() !== ''
  if (hasLength) {
    return column
  }

  const normalizedType = column.type.trim().toUpperCase()
  if (!INTEGER_TYPES_WITH_DEFAULT_DISPLAY_LENGTH.has(normalizedType)) {
    return column
  }

  return {
    ...column,
    length: getDefaultLengthForType(normalizedType),
  }
}

export function normalizeLoadedSchema(schema: TableDesignerSchema): TableDesignerSchema {
  return {
    ...schema,
    columns: schema.columns.map(normalizeLoadedColumn),
  }
}

export function resetSchemaFor(tab: TableDesignerTabState): TableDesignerSchema {
  if (tab.mode !== 'alter') return createBlankSchema()
  return cloneValue(tab.originalSchema ?? tab.currentSchema)
}

function isAlteredFromOriginal(tab: TableDesignerTabState): boolean {
  if (!tab.originalSchema) return false
  return !schemasEqual(
    canonicalizeSchema(tab.currentSchema),
    canonicalizeSchema(tab.originalSchema)
  )
}

function isCreateDraftStarted(schema: TableDesignerSchema): boolean {
  return (
    schema.columns.length > 0 ||
    schema.indexes.length > 0 ||
    schema.foreignKeys.length > 0 ||
    schema.tableName !== '' ||
    !schemasEqual(schema.properties, defaultProperties())
  )
}

export function computeIsDirty(tab: TableDesignerTabState): boolean {
  if (tab.mode === 'alter') return isAlteredFromOriginal(tab)
  return isCreateDraftStarted(tab.currentSchema)
}

export function createDefaultTabState({
  mode,
  connectionId,
  databaseName,
  objectName,
}: TableDesignerTarget): TableDesignerTabState {
  return {
    connectionId: connectionId,
    databaseName: databaseName,
    objectName: objectName,
    mode: mode,
    originalSchema: null,
    currentSchema: createBlankSchema(),
    isDirty: false,
    isLoading: false,
    loadError: null,
    ddl: '',
    ddlWarnings: [],
    isDdlLoading: false,
    ddlError: null,
    validationErrors: {},
    pendingNavigationAction: null,
    selectedSubTab: 'columns',
  }
}

export function isCreateDraftReadyForDdl(tab: TableDesignerTabState): boolean {
  return !(
    tab.mode === 'create' &&
    (tab.currentSchema.tableName.trim() === '' || Object.keys(tab.validationErrors).length > 0)
  )
}
