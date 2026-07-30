import { makeNodeId, useSchemaStore } from '../stores/schema-store'
import { useTableDataStore } from '../stores/table-data-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import type { NodeType, ObjectType } from '../types/schema'

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

export async function revealObjectInTree(
  connectionId: string,
  database: string,
  objectType: ObjectType,
  name: string
): Promise<void> {
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
    return
  }

  if (!categoryNode.isLoaded) {
    await useSchemaStore.getState().loadChildren(connectionId, categoryNodeId)
  }

  if (!getConnectionState()?.nodes[objectNodeId]) {
    return
  }

  const latestStore = useSchemaStore.getState()
  latestStore.ensurePathExpanded(connectionId, objectNodeId)
  latestStore.selectNode(objectNodeId, connectionId)
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
