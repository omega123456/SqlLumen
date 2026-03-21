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
// Workspace tab types
// ---------------------------------------------------------------------------

/** The kind of workspace tab. */
export type TabType = 'schema-info' | 'table-data' | 'query-editor'

/** Database object types (excludes 'column' and 'category'). */
export type ObjectType = 'table' | 'view' | 'procedure' | 'function' | 'trigger' | 'event'

/** A single workspace tab. */
export interface WorkspaceTab {
  id: string
  type: TabType
  label: string
  connectionId: string
  databaseName: string
  objectName: string
  objectType: ObjectType
  subTabId?: 'columns' | 'indexes' | 'fks' | 'ddl'
}

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
