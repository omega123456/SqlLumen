export interface PlaywrightListColumn {
  name: string
  dataType: string
  nullable: boolean
  columnKey: string
  defaultValue: string | null
  extra: string
  ordinalPosition: number
}

export interface PlaywrightSchemaInfo {
  columns: PlaywrightListColumn[]
  indexes: Array<{
    name: string
    indexType: string
    cardinality?: number
    columns: string[]
    isVisible?: boolean
    isUnique?: boolean
  }>
  foreignKeys: Array<{
    name: string
    columnName?: string
    referencedDatabase?: string
    referencedTable: string
    referencedColumn: string
    onDelete: string
    onUpdate: string
  }>
  ddl: string
  metadata: Record<string, unknown> | null
}

export interface PlaywrightQueryResult {
  queryId: string
  columns: Array<{ name: string; dataType: string }>
  totalRows: number
  executionTimeMs: number
  affectedRows: number
  firstPage: unknown[][]
  totalPages: number
  autoLimitApplied: boolean
}

export interface PlaywrightTableColumn {
  name: string
  dataType: string
  isBooleanAlias: boolean
  isNullable: boolean
  isPrimaryKey: boolean
  isUniqueKey: boolean
  hasDefault: boolean
  columnDefault: string | null
  isBinary: boolean
  isAutoIncrement: boolean
  enumValues?: string[]
}

export interface PlaywrightPrimaryKey {
  keyColumns: string[]
  hasAutoIncrement: boolean
  isUniqueKeyFallback: boolean
}

export interface PlaywrightTableDataResult {
  columns: PlaywrightTableColumn[]
  rows: unknown[][]
  currentPage: number
  pageSize: number
  primaryKey: PlaywrightPrimaryKey | null
  executionTimeMs: number
}

export interface PlaywrightForeignKey {
  name: string
  columnName: string
  referencedDatabase: string
  referencedTable: string
  referencedColumn: string
  onDelete: string
  onUpdate: string
}

export interface PlaywrightAnalyzeQueryColumn {
  name: string
  dataType: string
  isBooleanAlias: boolean
  enumValues: string[] | null
  isNullable: boolean
  isPrimaryKey: boolean
  isUniqueKey: boolean
  hasDefault: boolean
  columnDefault: string | null
  isBinary: boolean
  isAutoIncrement: boolean
}

export interface PlaywrightAnalyzeQueryTableInfo {
  database: string
  table: string
  columns: PlaywrightAnalyzeQueryColumn[]
  primaryKey: PlaywrightPrimaryKey
  foreignKeys: PlaywrightForeignKey[]
}

export type PlaywrightAnalyzeQueryResult = PlaywrightAnalyzeQueryTableInfo[]

export interface PlaywrightRoutineParametersResponse {
  parameters: Array<{
    name: string
    dataType: string
    mode: string
    ordinalPosition: number
  }>
  found: boolean
}
