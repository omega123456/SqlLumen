import type {
  HistoryTab,
  ObjectEditorTab,
  ProcessListTab,
  QueryEditorTab,
  TableDataTab,
  TableDesignerTab,
} from '../../types/schema'

export const CONNECTION_ID = 'conn-1'

export function queryTab(id: string, label = id): QueryEditorTab {
  return { id: id, type: 'query-editor', label: label, connectionId: CONNECTION_ID }
}

export function historyTab(id = 'history'): HistoryTab {
  return { id: id, type: 'history', label: 'History', connectionId: CONNECTION_ID }
}

export function processListTab(): ProcessListTab {
  return {
    id: `processlist-${CONNECTION_ID}`,
    type: 'processlist',
    label: 'Process list',
    connectionId: CONNECTION_ID,
  }
}

export function tableTab(id: string, overrides: Partial<TableDataTab> = {}): TableDataTab {
  return {
    id: id,
    type: 'table-data',
    label: 'users',
    connectionId: CONNECTION_ID,
    databaseName: 'shop',
    objectName: 'users',
    objectType: 'table',
    ...overrides,
  }
}

export function designerTab(id: string): TableDesignerTab {
  return {
    id: id,
    type: 'table-designer',
    label: 'users',
    connectionId: CONNECTION_ID,
    mode: 'alter',
    databaseName: 'shop',
    objectName: 'users',
  }
}

export function objectEditorTab(id: string): ObjectEditorTab {
  return {
    id: id,
    type: 'object-editor',
    label: 'View: active_users',
    connectionId: CONNECTION_ID,
    databaseName: 'shop',
    objectName: 'active_users',
    objectType: 'view',
    mode: 'alter',
  }
}
