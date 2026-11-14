import type { ColumnMeta } from './schema/query-results'

export type {
  TabType,
  DesignerSubTab,
  EditableObjectType,
  SchemaInfoTab,
  TableDataTab,
  QueryEditorTab,
  TableDesignerTab,
  ObjectEditorTab,
  HistoryTab,
  ProcessListTab,
  WorkspaceTab,
  DistributiveOmit,
} from './schema/workspace-tabs'
export type {
  ColumnMeta,
  BlobValueResponse,
  BlobEnvelope,
  QueryResultMeta,
  ResultWindow,
  ResultViewSort,
  ResultViewSpec,
  FullExportBlockedReason,
  ResultWindowMeta,
  SetResultViewResult,
  FetchResultWindowResult,
  RemoveResultRowsResult,
  FrontendRowResidencyStatus,
  FrontendRowResidencyState,
  ViewMode,
  SortDirection,
  ExportFormat,
  ExportOptions,
  SelectedCellInfo,
  FilterOperator,
  FilterCondition,
  RowEditState,
  MultiQueryResultItem,
  MultiQueryResult,
  QueryTableEditInfo,
  QueryEditableColumnMap,
} from './schema/query-results'
export type {
  TableDataColumnMeta,
  PrimaryKeyInfo,
  TableDataResponse,
  TableDataCacheRestoreStatus,
  TableDataCacheRestoreResult,
  TableDataCacheSyncStatus,
  TableDataCacheSyncResult,
  TableDataSortInfo,
  TableDataTabState,
} from './schema/table-data'
export type {
  DefaultValueModel,
  TableDesignerColumnDef,
  TableDesignerIndexDef,
  TableDesignerForeignKeyDef,
  TableDesignerProperties,
  TableDesignerSchema,
  GenerateDdlRequest,
  GenerateDdlResponse,
} from './schema/table-designer'
export type {
  RoutineParameter,
  SaveObjectResponse,
  SettingsSection,
  ShortcutBinding,
  ShortcutActionDescriptor,
  AppInfo,
  HistoryEntry,
  HistoryPage,
  FavoriteEntry,
  CreateFavoriteInput,
  UpdateFavoriteInput,
} from './schema/app-records'

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

export interface TreeNode {
  id: string
  label: string
  type: NodeType
  parentId: string | null
  hasChildren: boolean
  isLoaded: boolean
  databaseName?: string
  objectName?: string
  metadata?: {
    columnType?: string
    categoryType?: string
    databaseName?: string
  }
}

export type ObjectType = 'table' | 'view' | 'procedure' | 'function' | 'trigger' | 'event'

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
  referencedDatabase: string
  referencedTable: string
  referencedColumn: string
  onDelete: string
  onUpdate: string
}

export interface ForeignKeyColumnInfo {
  columnName: string
  referencedDatabase: string
  referencedTable: string
  referencedColumn: string
  constraintName: string
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

export interface SchemaInfoResponse {
  columns: ColumnInfo[]
  indexes: IndexInfo[]
  foreignKeys: ForeignKeyInfo[]
  ddl: string
  metadata: TableMetadata | null
}

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

export interface ViewInfo {
  name: string
}

export interface TriggerInfo {
  name: string
}

export type PaletteTypeFilter = 'table' | 'view' | 'procedure' | 'function' | 'trigger'

export type PaletteResultType = PaletteTypeFilter | 'column'

export interface SearchableObject {
  database: string
  objectType: PaletteResultType
  name: string
  table?: string
  metaLabel?: string
}

export interface SchemaMetadataResponse {
  databases: string[]
  tables: Record<string, TableInfo[]>
  columns: Record<string, ColumnMeta[]>
  routines: Record<string, RoutineMeta[]>
}

export interface SchemaMetadataFull {
  databases: string[]
  tables: Record<string, TableInfo[]>
  views: Record<string, ViewInfo[]>
  columns: Record<string, ColumnMeta[]>
  routines: Record<string, RoutineMeta[]>
  triggers: Record<string, TriggerInfo[]>
  foreignKeys: Record<string, ForeignKeyInfo[]>
  indexes: Record<string, IndexInfo[]>
}
