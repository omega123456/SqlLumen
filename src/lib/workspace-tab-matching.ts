import type { SchemaInfoTab, TableDataTab, WorkspaceTab } from '../types/schema'

export interface ObjectTabIdentity {
  databaseName: string
  objectName: string
}

export function isSameObjectIdentity(left: ObjectTabIdentity, right: ObjectTabIdentity): boolean {
  return left.databaseName === right.databaseName && left.objectName === right.objectName
}

export function isTableDataTabOfObject(
  tab: WorkspaceTab,
  identity: ObjectTabIdentity
): tab is TableDataTab {
  if (tab.type !== 'table-data') return false
  return isSameObjectIdentity(tab, identity)
}

export function isSchemaInfoTabOfObject(
  tab: WorkspaceTab,
  identity: ObjectTabIdentity
): tab is SchemaInfoTab {
  if (tab.type !== 'schema-info') return false
  return isSameObjectIdentity(tab, identity)
}
