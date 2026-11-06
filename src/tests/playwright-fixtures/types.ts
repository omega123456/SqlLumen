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

/**
 * A mock query result as the fixtures define it: the full set of base rows the
 * mock "Rust cache" holds. Execute responses never carry these rows; they are
 * served as windows (`PlaywrightResultWindow`).
 */
export interface PlaywrightQueryResultFixture {
  queryId: string
  columns: Array<{ name: string; dataType: string }>
  executionTimeMs: number
  totalTimeMs: number
  affectedRows: number
  /** Every base row of the result (identity order). */
  rows: unknown[][]
  autoLimitApplied: boolean
  /** LIMIT injected by auto-LIMIT, or null. */
  appliedRowLimit?: number | null
  /** True when the result hit the row ceiling. */
  truncated?: boolean
  rowCeiling?: number
  fullExportBlockedReason?: 'call' | 'locking' | 'unknownDatabase' | null
  /** Multi-result items only. */
  sourceSql?: string
  reExecutable?: boolean
  error?: string | null
}

/** A window of a result's current view (`fetch_result_window` and `firstWindow`). */
export interface PlaywrightResultWindow {
  offset: number
  rows: unknown[][]
  baseIndices: number[]
}

/** The windowed execute response (`execute_query`, and each multi-result item). */
export interface PlaywrightQueryResult {
  queryId: string
  columns: Array<{ name: string; dataType: string }>
  totalRows: number
  executionTimeMs: number
  totalTimeMs: number
  affectedRows: number
  autoLimitApplied: boolean
  viewRowCount: number
  viewVersion: number
  truncated: boolean
  rowCeiling: number
  appliedRowLimit: number | null
  fullExportBlockedReason: 'call' | 'locking' | 'unknownDatabase' | null
  firstWindow: PlaywrightResultWindow
  sourceSql?: string
  reExecutable?: boolean
  error?: string | null
}

/** The sort-plus-filter view spec the mock applies (same shape as the IPC `viewSpec`). */
export interface PlaywrightViewSpec {
  sort: { column: string; direction: 'asc' | 'desc' } | null
  filters: Array<{ column: string; operator: string; value: string }>
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
