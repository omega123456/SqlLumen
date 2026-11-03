import { useConnectionStore } from '../stores/connection-store'
import { makeNodeId, useSchemaStore } from '../stores/schema-store'
import { useTableDataStore } from '../stores/table-data-store'
import { showWarningToast } from '../stores/toast-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import type { NodeType, ObjectType, WorkspaceTab } from '../types/schema'

const TABLE_DATA_OBJECT_TYPES = new Set<ObjectType>(['table', 'view'])
const SCHEMA_INFO_OBJECT_TYPES = new Set<ObjectType>(['procedure', 'function', 'trigger', 'event'])

function isObjectType(nodeType: NodeType): nodeType is ObjectType {
  return (
    TABLE_DATA_OBJECT_TYPES.has(nodeType as ObjectType) ||
    SCHEMA_INFO_OBJECT_TYPES.has(nodeType as ObjectType)
  )
}

function getDefaultTabTypeForObject(objectType: ObjectType): 'table-data' | 'schema-info' {
  return TABLE_DATA_OBJECT_TYPES.has(objectType) ? 'table-data' : 'schema-info'
}

export function openObjectDefaultTab(
  connectionId: string,
  database: string,
  objectType: ObjectType,
  name: string,
  label: string = name
): void {
  const openTab = useWorkspaceStore.getState().openTab
  const tabType = getDefaultTabTypeForObject(objectType)

  openTab({
    type: tabType,
    connectionId,
    databaseName: database,
    objectName: name,
    objectType,
    label,
  })
}

/**
 * Load, expand and select an object's node in the object browser tree.
 * Resolves to true when the node exists and was selected.
 */
export async function revealObjectInTree(
  connectionId: string,
  database: string,
  objectType: ObjectType,
  name: string
): Promise<boolean> {
  const schemaStore = useSchemaStore.getState()
  const databaseNodeId = makeNodeId('database', database, database)
  const categoryNodeId = makeNodeId('category', database, objectType)
  const objectNodeId = makeNodeId(objectType, database, name)

  const getConnectionState = () => useSchemaStore.getState().connectionStates[connectionId]

  if (!getConnectionState()?.nodes[databaseNodeId]) {
    await schemaStore.loadDatabases(connectionId)
  }

  if (!getConnectionState()?.nodes[databaseNodeId]?.isLoaded) {
    await useSchemaStore.getState().loadChildren(connectionId, databaseNodeId)
  }

  const categoryNode = getConnectionState()?.nodes[categoryNodeId]
  if (!categoryNode) {
    return false
  }

  if (!categoryNode.isLoaded) {
    await useSchemaStore.getState().loadChildren(connectionId, categoryNodeId)
  }

  if (!getConnectionState()?.nodes[objectNodeId]) {
    return false
  }

  const latestStore = useSchemaStore.getState()
  latestStore.ensurePathExpanded(connectionId, objectNodeId)
  latestStore.selectNode(objectNodeId, connectionId)
  return true
}

/** The database object a workspace tab shows, if it shows an existing one. */
export interface TabRevealTarget {
  database: string
  objectType: ObjectType
  name: string
}

/**
 * Resolve the tree object behind a workspace tab. Returns null for tabs without
 * one (query editor, history, process list) and for create-mode designers and
 * editors, whose object does not exist yet.
 */
export function getTabRevealTarget(tab: WorkspaceTab): TabRevealTarget | null {
  switch (tab.type) {
    case 'schema-info':
    case 'table-data':
      return { database: tab.databaseName, objectType: tab.objectType, name: tab.objectName }
    case 'table-designer':
      return tab.mode === 'alter'
        ? { database: tab.databaseName, objectType: 'table', name: tab.objectName }
        : null
    case 'object-editor':
      return tab.mode === 'alter'
        ? { database: tab.databaseName, objectType: tab.objectType, name: tab.objectName }
        : null
    default:
      return null
  }
}

/** True for tab types that show a database object, even one not created yet. */
export function isObjectTab(tab: WorkspaceTab): boolean {
  return (
    tab.type === 'schema-info' ||
    tab.type === 'table-data' ||
    tab.type === 'table-designer' ||
    tab.type === 'object-editor'
  )
}

/**
 * Select a tab's object in the object browser, make its database the active one
 * (the same as clicking it in the tree), then scroll to and focus the row.
 */
export async function revealTabInObjectBrowser(tab: WorkspaceTab): Promise<void> {
  const target = getTabRevealTarget(tab)
  if (!target) {
    return
  }

  const { database, objectType, name } = target
  const found = await revealObjectInTree(tab.connectionId, database, objectType, name)
  if (!found) {
    showWarningToast(
      `Couldn't find ${name} in the object browser`,
      'It may have been renamed or dropped. Refresh the database and try again.'
    )
    return
  }

  void useConnectionStore.getState().setActiveDatabase(tab.connectionId, database)
  useSchemaStore.getState().requestReveal(tab.connectionId, makeNodeId(objectType, database, name))
}

export async function activateObjectFromPalette(
  connectionId: string,
  database: string,
  objectType: NodeType,
  name: string,
  label: string = name
): Promise<void> {
  if (!isObjectType(objectType)) {
    return
  }

  openObjectDefaultTab(connectionId, database, objectType, name, label)
  await revealObjectInTree(connectionId, database, objectType, name)
}

export function activateColumnFromPalette(
  connectionId: string,
  database: string,
  table: string,
  columnName: string
): void {
  openObjectDefaultTab(connectionId, database, 'table', table, table)

  const workspace = useWorkspaceStore.getState()
  const matchingTabs = (workspace.tabsByConnection[connectionId] ?? []).filter(
    (tab) => tab.type === 'table-data' && tab.databaseName === database && tab.objectName === table
  )
  const activeTabId = workspace.activeTabByConnection[connectionId]
  const tab = matchingTabs.find((candidate) => candidate.id === activeTabId) ?? matchingTabs[0]
  if (tab) {
    useTableDataStore.getState().requestColumnJump(tab.id, columnName)
  }
}
