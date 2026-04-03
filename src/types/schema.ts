/**
 * TypeScript types for schema tree, workspace tabs, and backend schema data.
 *
 * Field names use camelCase — the Rust backend uses snake_case internally,
 * but Tauri's serde serialization handles conversion via `#[serde(rename_all = "camelCase")]`.
 */

// ---------------------------------------------------------------------------
// Tree node types
// ---------------------------------------------------------------------------

/** Type of node in the schema tree. */
export type NodeType =
  | 'database'
  | 'table'
  | 'view'
  | 'procedure'
  | 'function'
  | 'trigger'
  | 'event'
  | 'column'
  | 'category'

/** A single node in the flat tree map. */
export interface TreeNode {
  /** Collision-safe ID: `{type}:{btoa(database)}:{btoa(name)}` */
  id: string
  label: string
  type: NodeType
  parentId: string | null
  hasChildren: boolean
  isLoaded: boolean
  /** For non-database nodes: the database this node belongs to. */
  databaseName?: string
  /** For object/column nodes: the object name (parsed from the node ID). */
  objectName?: string
  metadata?: {
    columnType?: string
    categoryType?: string
    databaseName?: string
  }
}

// ---------------------------------------------------------------------------
// Workspace tab types — discriminated union
// ---------------------------------------------------------------------------

/** The kind of workspace tab. */
export type TabType = 'schema-info' | 'table-data' | 'query-editor' | 'table-designer'

export type DesignerSubTab = 'columns' | 'indexes' | 'fks' | 'properties' | 'ddl'

/** Database object types (excludes 'column' and 'category'). */
export type ObjectType = 'table' | 'view' | 'procedure' | 'function' | 'trigger' | 'event'

/** Base fields shared by all workspace tab variants. */
interface WorkspaceTabBase {
  id: string
  label: string
  connectionId: string
  subTabId?: 'columns' | 'indexes' | 'fks' | 'ddl'
  /** True when a close was requested but deferred pending unsaved-edit resolution. */
  pendingClose?: boolean
}

/** A schema-info tab (shows DDL, columns, indexes, etc.). */
export interface SchemaInfoTab extends WorkspaceTabBase {
  type: 'schema-info'
  databaseName: string
  objectName: string
  objectType: ObjectType
}

/** A table-data tab (shows table rows). */
export interface TableDataTab extends WorkspaceTabBase {
  type: 'table-data'
  databaseName: string
  objectName: string
  objectType: ObjectType
}

/** A query editor tab (Monaco editor + results). */
export interface QueryEditorTab extends WorkspaceTabBase {
  type: 'query-editor'
}

/** A table designer tab (CREATE/ALTER TABLE designer). */
export interface TableDesignerTab extends WorkspaceTabBase {
  type: 'table-designer'
  mode: 'create' | 'alter'
  databaseName: string
  objectName: string
}

/** Union of all workspace tab variants. */
export type WorkspaceTab = SchemaInfoTab | TableDataTab | QueryEditorTab | TableDesignerTab

/** Distributive Omit — works correctly on union types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never

// ---------------------------------------------------------------------------
// Schema data types (match Rust backend structs — camelCase via serde)
// ---------------------------------------------------------------------------

export interface DatabaseDetails {
  name: string
  defaultCharacterSet: string
  defaultCollation: string
}

export interface CharsetInfo {
  charset: string
  description: string
  defaultCollation: string
  maxLength: number
}

export interface CollationInfo {
  name: string
  charset: string
  isDefault: boolean
}

export interface ColumnInfo {
  name: string
  dataType: string
  nullable: boolean
  columnKey: string
  defaultValue: string | null
  extra: string
  ordinalPosition: number
}

export interface IndexInfo {
  name: string
  indexType: string
  cardinality: number | null
  columns: string[]
  isVisible: boolean
  isUnique: boolean
}

export interface ForeignKeyInfo {
  name: string
  columnName: string
  referencedTable: string
  referencedColumn: string
  onDelete: string
  onUpdate: string
}

export interface TableMetadata {
  engine: string
  collation: string
  autoIncrement: number | null
  createTime: string | null
  tableRows: number
  dataLength: number
  indexLength: number
}

/** Full schema info response from the backend `get_schema_info` command. */
export interface SchemaInfoResponse {
  columns: ColumnInfo[]
  indexes: IndexInfo[]
  foreignKeys: ForeignKeyInfo[]
  ddl: string
  metadata: TableMetadata | null
}

// ---------------------------------------------------------------------------
// Frontend-composed type (combines backend data + tab context)
// ---------------------------------------------------------------------------

/** Schema info enriched with tab context for display in SchemaInfoTab. */
export interface SchemaInfoData {
  objectType: ObjectType
  objectName: string
  databaseName: string
  columns: ColumnInfo[]
  indexes: IndexInfo[]
  foreignKeys: ForeignKeyInfo[]
  ddl: string
  metadata: TableMetadata | null
}

// ---------------------------------------------------------------------------
// Query result types (Phase 4)
// ---------------------------------------------------------------------------

export interface ColumnMeta {
  name: string
  dataType: string
}

export interface QueryResultMeta {
  queryId: string
  columns: ColumnMeta[]
  totalRows: number
  executionTimeMs: number
  affectedRows: number
  totalPages: number
  autoLimitApplied: boolean
}

export interface ResultPage {
  rows: unknown[][]
  page: number
  totalPages: number
}

export interface TableInfo {
  name: string
  engine: string
  charset: string
  rowCount: number
  dataSize: number
}

export interface RoutineMeta {
  name: string
  routineType: string
}

export interface SchemaMetadataResponse {
  databases: string[]
  tables: Record<string, TableInfo[]>
  columns: Record<string, ColumnMeta[]>
  routines: Record<string, RoutineMeta[]>
}

// ---------------------------------------------------------------------------
// Result view / export types (Phase 5)
// ---------------------------------------------------------------------------

export type ViewMode = 'grid' | 'form' | 'text'

export type SortDirection = 'asc' | 'desc'

export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'sql-insert'

export interface ExportOptions {
  format: ExportFormat
  filePath: string
  includeHeaders: boolean
  tableName?: string
}

// ---------------------------------------------------------------------------
// Table Data Browser types (Phase 6)
// ---------------------------------------------------------------------------

/** Extended column metadata for table data. */
export interface TableDataColumnMeta {
  name: string
  dataType: string
  isBooleanAlias: boolean
  enumValues?: string[]
  isNullable: boolean
  isPrimaryKey: boolean
  isUniqueKey: boolean
  hasDefault: boolean
  columnDefault: string | null
  isBinary: boolean
  isAutoIncrement: boolean
}

/** Primary/unique key info from backend. */
export interface PrimaryKeyInfo {
  keyColumns: string[]
  hasAutoIncrement: boolean
  isUniqueKeyFallback: boolean
}

/** Response from fetch_table_data. */
export interface TableDataResponse {
  columns: TableDataColumnMeta[]
  rows: unknown[][]
  totalRows: number
  currentPage: number
  totalPages: number
  pageSize: number
  primaryKey: PrimaryKeyInfo | null
  executionTimeMs: number
}

// ---------------------------------------------------------------------------
// Table Designer types (Phase 7.1)
// ---------------------------------------------------------------------------

export type DefaultValueModel =
  | { tag: 'NO_DEFAULT' }
  | { tag: 'NULL_DEFAULT' }
  | { tag: 'LITERAL'; value: string }
  | { tag: 'EXPRESSION'; value: string }

export interface TableDesignerColumnDef {
  name: string
  type: string
  typeModifier?: string
  length: string
  nullable: boolean
  isPrimaryKey: boolean
  isAutoIncrement: boolean
  defaultValue: DefaultValueModel
  comment: string
  originalName: string
}

export interface TableDesignerIndexDef {
  name: string
  indexType: 'PRIMARY' | 'UNIQUE' | 'INDEX' | 'FULLTEXT'
  columns: string[]
}

export interface TableDesignerForeignKeyDef {
  name: string
  sourceColumn: string
  referencedTable: string
  referencedColumn: string
  onDelete: string
  onUpdate: string
  isComposite: boolean
}

export interface TableDesignerProperties {
  engine: string
  charset: string
  collation: string
  autoIncrement: number | null
  rowFormat: string
  comment: string
}

export interface TableDesignerSchema {
  tableName: string
  columns: TableDesignerColumnDef[]
  indexes: TableDesignerIndexDef[]
  foreignKeys: TableDesignerForeignKeyDef[]
  properties: TableDesignerProperties
}

export interface GenerateDdlRequest {
  originalSchema: TableDesignerSchema | null
  currentSchema: TableDesignerSchema
  database: string
  mode: 'create' | 'alter'
}

export interface GenerateDdlResponse {
  ddl: string
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

/** Supported filter operators for the table data filter dialog. */
export type FilterOperator =
  | '>'
  | '>='
  | '<'
  | '<='
  | '=='
  | 'LIKE'
  | 'NOT LIKE'
  | 'IS NULL'
  | 'IS NOT NULL'

/** A single filter condition applied to a column. */
export interface FilterCondition {
  column: string
  operator: FilterOperator
  value: string
}

/** Tracks the currently-editing row. */
export interface RowEditState {
  /** PK column values that uniquely identify the row (or temp ID for new rows). */
  rowKey: Record<string, unknown>
  /** Original values before editing started (used for UPDATE WHERE clause). */
  originalValues: Record<string, unknown>
  /** Current (possibly modified) values. */
  currentValues: Record<string, unknown>
  /** Set of column names that have been modified. */
  modifiedColumns: Set<string>
  /** True if this is an unsaved new row (INSERT pending). */
  isNewRow: boolean
  /** Temporary client-side ID for new rows (cleared after save). */
  tempId?: string
}

/** Sort info for table data. */
export interface TableDataSortInfo {
  column: string
  direction: 'asc' | 'desc'
}

/** Per-tab table data state. */
export interface TableDataTabState {
  // Data
  columns: TableDataColumnMeta[]
  rows: unknown[][]
  totalRows: number
  currentPage: number
  totalPages: number
  pageSize: number
  primaryKey: PrimaryKeyInfo | null
  executionTimeMs: number

  // Table context
  connectionId: string
  database: string
  table: string

  // Edit state
  editState: RowEditState | null

  // View state
  viewMode: 'grid' | 'form'
  selectedRowKey: Record<string, unknown> | null

  // Filter/sort
  filterModel: FilterCondition[]
  sort: TableDataSortInfo | null

  // UI state
  isLoading: boolean
  error: string | null
  saveError: string | null
  isExportDialogOpen: boolean

  // Unsaved changes dialog state
  pendingNavigationAction: (() => void) | null
}

// ---------------------------------------------------------------------------
// Query Result Editing types
// ---------------------------------------------------------------------------

/** Metadata for a table detected in a SQL query, used for inline editing. */
export interface QueryTableEditInfo {
  database: string
  table: string
  columns: TableDataColumnMeta[]
  primaryKey: PrimaryKeyInfo | null
}

/** Map of result-set column index → whether the column is editable. */
export type QueryEditableColumnMap = Map<number, boolean>
