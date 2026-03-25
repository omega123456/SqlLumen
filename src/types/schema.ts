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
export type TabType = 'schema-info' | 'table-data' | 'query-editor'

/** Database object types (excludes 'column' and 'category'). */
export type ObjectType = 'table' | 'view' | 'procedure' | 'function' | 'trigger' | 'event'

/** Base fields shared by all workspace tab variants. */
interface WorkspaceTabBase {
  id: string
  label: string
  connectionId: string
  subTabId?: 'columns' | 'indexes' | 'fks' | 'ddl'
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

/** Union of all workspace tab variants. */
export type WorkspaceTab = SchemaInfoTab | TableDataTab | QueryEditorTab

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
