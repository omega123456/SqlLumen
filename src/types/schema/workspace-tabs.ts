import type { ObjectType } from '../schema'

export type TabType =
  | 'schema-info'
  | 'table-data'
  | 'query-editor'
  | 'table-designer'
  | 'object-editor'
  | 'history'
  | 'processlist'

export type DesignerSubTab = 'columns' | 'indexes' | 'fks' | 'properties' | 'ddl'

export type EditableObjectType = 'view' | 'procedure' | 'function' | 'trigger' | 'event'

interface WorkspaceTabBase {
  id: string
  label: string
  connectionId: string
  subTabId?: 'columns' | 'indexes' | 'fks' | 'ddl'
  pendingClose?: boolean
}

export interface SchemaInfoTab extends WorkspaceTabBase {
  type: 'schema-info'
  databaseName: string
  objectName: string
  objectType: ObjectType
}

export interface TableDataTab extends WorkspaceTabBase {
  type: 'table-data'
  databaseName: string
  objectName: string
  objectType: ObjectType
  parentQueryTabId?: string
}

export interface QueryEditorTab extends WorkspaceTabBase {
  type: 'query-editor'
}

export interface TableDesignerTab extends WorkspaceTabBase {
  type: 'table-designer'
  mode: 'create' | 'alter'
  databaseName: string
  objectName: string
}

export interface ObjectEditorTab extends WorkspaceTabBase {
  type: 'object-editor'
  databaseName: string
  objectName: string
  objectType: EditableObjectType
  mode: 'create' | 'alter'
}

export interface HistoryTab extends WorkspaceTabBase {
  type: 'history'
}

export interface ProcessListTab extends WorkspaceTabBase {
  type: 'processlist'
}

export type WorkspaceTab =
  | SchemaInfoTab
  | TableDataTab
  | QueryEditorTab
  | TableDesignerTab
  | ObjectEditorTab
  | HistoryTab
  | ProcessListTab

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
