import { useConnectionStore } from '../stores/connection-store'
import { makeNodeId, useSchemaStore } from '../stores/schema-store'
import { useTableDataStore } from '../stores/table-data-store'
import { showWarningToast } from '../stores/toast-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import type { NodeType, ObjectType, WorkspaceTab } from '../types/schema'
import { isTableDataTabOfObject } from './workspace-tab-matching'

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

export interface ObjectTabTarget {
  connectionId: string
  database: string
  objectType: ObjectType
  name: string
  label?: string
}

export function openObjectDefaultTab({
  connectionId,
  database,
  objectType,
  name,
  label = name,
}: ObjectTabTarget): void {
  const openTab = useWorkspaceStore.getState().openTab
  const tabType = getDefaultTabTypeForObject(objectType)

  openTab({
    type: tabType,
    connectionId: connectionId,
    databaseName: database,
    objectName: name,
    objectType: objectType,
    label: label,
  })
}

async function ensureDatabaseNodeLoaded(connectionId: string, database: string): Promise<void> {
  const databaseNodeId = makeNodeId('database', database, database)
  const getDatabaseNode = () =>
    useSchemaStore.getState().connectionStates[connectionId]?.nodes[databaseNodeId]

  if (!getDatabaseNode()) {
    await useSchemaStore.getState().loadDatabases(connectionId)
  }

  if (!getDatabaseNode()?.isLoaded) {
    await useSchemaStore.getState().loadChildren(connectionId, databaseNodeId)
  }
}

export interface ObjectTreeTarget {
  connectionId: string
  database: string
  objectType: ObjectType
  name: string
}

/**
 * Load, expand and select an object's node in the object browser tree.
 * Resolves to true when the node exists and was selected.
 */
export async function revealObjectInTree({
  connectionId,
  database,
  objectType,
  name,
}: ObjectTreeTarget): Promise<boolean> {
  const categoryNodeId = makeNodeId('category', database, objectType)
  const objectNodeId = makeNodeId(objectType, database, name)

  const getConnectionState = () => useSchemaStore.getState().connectionStates[connectionId]

  await ensureDatabaseNodeLoaded(connectionId, database)

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
  const found = await revealObjectInTree({
    connectionId: tab.connectionId,
    database: database,
    objectType: objectType,
    name: name,
  })
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

export interface PaletteObjectTarget {
  connectionId: string
  database: string
  objectType: NodeType
  name: string
  label?: string
}

export async function activateObjectFromPalette({
  connectionId,
  database,
  objectType,
  name,
  label = name,
}: PaletteObjectTarget): Promise<void> {
  if (!isObjectType(objectType)) {
    return
  }

  openObjectDefaultTab({
    connectionId: connectionId,
    database: database,
    objectType: objectType,
    name: name,
    label: label,
  })
  await revealObjectInTree({
    connectionId: connectionId,
    database: database,
    objectType: objectType,
    name: name,
  })
}

export interface PaletteColumnTarget {
  connectionId: string
  database: string
  table: string
  columnName: string
}

export function activateColumnFromPalette({
  connectionId,
  database,
  table,
  columnName,
}: PaletteColumnTarget): void {
  openObjectDefaultTab({
    connectionId: connectionId,
    database: database,
    objectType: 'table',
    name: table,
    label: table,
  })

  const workspace = useWorkspaceStore.getState()
  const tableIdentity = { databaseName: database, objectName: table }
  const matchingTabs = (workspace.tabsByConnection[connectionId] ?? []).filter((tab) =>
    isTableDataTabOfObject(tab, tableIdentity)
  )
  const activeTabId = workspace.activeTabByConnection[connectionId]
  const tab = matchingTabs.find((candidate) => candidate.id === activeTabId) ?? matchingTabs[0]
  if (tab) {
    useTableDataStore.getState().requestColumnJump(tab.id, columnName)
  }
}
