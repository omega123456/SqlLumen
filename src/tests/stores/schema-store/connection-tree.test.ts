import { describe, expect, it } from 'vitest'
import {
  buildChildIndex,
  createDefaultConnectionState,
  treeResetKeepingView,
  treeWithCategoryRefreshed,
  treeWithDatabaseCategories,
  treeWithDatabaseRefreshed,
  treeWithListedDatabases,
  treeWithLoadedChildren,
  treeWithNodeLoading,
  treeWithNodeLoadingCleared,
  treeWithPathExpanded,
  treeWithToggledExpansion,
} from '../../../stores/schema-store/connection-tree'
import { databaseNodeId, makeNodeId } from '../../../stores/schema-store/node-ids'
import type { ConnectionTreeState } from '../../../stores/schema-store'
import type { TreeNode } from '../../../types/schema'

const SHOP_ID = databaseNodeId('shop')
const TABLES_ID = makeNodeId('category', 'shop', 'table')
const USERS_ID = makeNodeId('table', 'shop', 'users')
const EMAIL_ID = makeNodeId('column', 'shop', 'users.email')

function node(id: string, overrides: Partial<TreeNode>): TreeNode {
  return {
    id: id,
    label: id,
    type: 'table',
    parentId: null,
    hasChildren: false,
    isLoaded: false,
    databaseName: 'shop',
    ...overrides,
  }
}

function populatedTree(overrides: Partial<ConnectionTreeState> = {}): ConnectionTreeState {
  const nodes = {
    [SHOP_ID]: node(SHOP_ID, {
      type: 'database',
      label: 'shop',
      hasChildren: true,
      isLoaded: true,
    }),
    [TABLES_ID]: node(TABLES_ID, {
      type: 'category',
      label: 'Tables',
      parentId: SHOP_ID,
      hasChildren: true,
      isLoaded: true,
    }),
    [USERS_ID]: node(USERS_ID, { label: 'users', parentId: TABLES_ID, hasChildren: true }),
    [EMAIL_ID]: node(EMAIL_ID, { type: 'column', label: 'email', parentId: USERS_ID }),
  }
  return {
    ...createDefaultConnectionState(),
    nodes: nodes,
    childIdsByParentId: buildChildIndex(nodes),
    ...overrides,
  }
}

describe('connection tree transitions', () => {
  it('indexes children sorted by label under their parent', () => {
    const nodes = {
      b: node('b', { label: 'beta' }),
      a: node('a', { label: 'alpha' }),
    }
    expect(buildChildIndex(nodes)).toEqual({ __root__: ['a', 'b'] })
  })

  it('merges listed databases, dropping nodes of unlisted ones', () => {
    const merged = treeWithListedDatabases(populatedTree(), ['analytics'])
    expect(Object.keys(merged.nodes)).toEqual([databaseNodeId('analytics')])
    expect(merged.loadingNodes.size).toBe(0)
  })

  it('keeps a loaded listed database and its descendants', () => {
    const merged = treeWithListedDatabases(populatedTree(), ['shop'])
    expect(merged.nodes[SHOP_ID].isLoaded).toBe(true)
    expect(merged.nodes[USERS_ID]).toBeDefined()
  })

  it('adds the category nodes under a database', () => {
    const tree = { ...createDefaultConnectionState(), nodes: { [SHOP_ID]: node(SHOP_ID, {}) } }
    const expanded = treeWithDatabaseCategories(tree, SHOP_ID)
    expect(expanded.childIdsByParentId[SHOP_ID]).toHaveLength(6)
    expect(expanded.nodes[SHOP_ID].isLoaded).toBe(true)
  })

  it('tracks loading and merges loaded children', () => {
    const loading = treeWithNodeLoading(populatedTree(), USERS_ID)
    expect(loading.loadingNodes.has(USERS_ID)).toBe(true)
    const tree = populatedTree({ loadingNodes: loading.loadingNodes })
    const idNode = node('id-node', { type: 'column', label: 'id', parentId: USERS_ID })
    const loaded = treeWithLoadedChildren(tree, { nodeId: USERS_ID, childNodes: [idNode] })
    expect(loaded.childIdsByParentId[USERS_ID]).toEqual([EMAIL_ID, 'id-node'])
    expect(loaded.nodes[USERS_ID].isLoaded).toBe(true)
    expect(loaded.loadingNodes.size).toBe(0)
    expect(treeWithNodeLoadingCleared(tree, USERS_ID).loadingNodes.size).toBe(0)
  })

  it('toggles expansion', () => {
    const expanded = treeWithToggledExpansion(populatedTree(), USERS_ID)
    expect(expanded.expandedNodes.has(USERS_ID)).toBe(true)
    const collapsed = treeWithToggledExpansion(populatedTree(expanded), USERS_ID)
    expect(collapsed.expandedNodes.has(USERS_ID)).toBe(false)
  })

  it('expands every collapsed ancestor, or reports nothing to do', () => {
    const expansion = treeWithPathExpanded(populatedTree(), EMAIL_ID)
    expect([...(expansion?.expandedNodes ?? [])]).toEqual([USERS_ID, TABLES_ID, SHOP_ID])
    const alreadyExpanded = populatedTree({ expandedNodes: expansion?.expandedNodes })
    expect(treeWithPathExpanded(alreadyExpanded, EMAIL_ID)).toBeNull()
  })

  it('refreshes a database, keeping it expanded and bumping the generation', () => {
    const tree = populatedTree({
      expandedNodes: new Set([SHOP_ID, USERS_ID]),
      loadingNodes: new Set([USERS_ID]),
      selectedNodeId: USERS_ID,
    })
    const refreshed = treeWithDatabaseRefreshed(tree, 'shop')
    expect(Object.keys(refreshed.nodes)).toEqual([SHOP_ID])
    expect(refreshed.nodes[SHOP_ID].isLoaded).toBe(false)
    expect([...refreshed.expandedNodes]).toEqual([SHOP_ID])
    expect(refreshed.loadingNodes.size).toBe(0)
    expect(refreshed.selectedNodeId).toBeNull()
    expect(refreshed.loadGeneration).toBe(1)
  })

  it('refreshes a category, removing its children and grandchildren', () => {
    const tree = populatedTree({
      expandedNodes: new Set([USERS_ID]),
      loadingNodes: new Set([TABLES_ID]),
      selectedNodeId: SHOP_ID,
    })
    const refreshed = treeWithCategoryRefreshed(tree, TABLES_ID)
    expect(Object.keys(refreshed.nodes).sort()).toEqual([SHOP_ID, TABLES_ID].sort())
    expect(refreshed.nodes[TABLES_ID].isLoaded).toBe(false)
    expect(refreshed.expandedNodes.size).toBe(0)
    expect(refreshed.loadingNodes.size).toBe(0)
    expect(refreshed.selectedNodeId).toBe(SHOP_ID)
  })

  it('resets the tree while keeping the filter and selection', () => {
    const tree = populatedTree({ filterText: 'us', selectedNodeId: USERS_ID, loadGeneration: 4 })
    expect(treeResetKeepingView(tree)).toEqual({
      ...createDefaultConnectionState(),
      filterText: 'us',
      selectedNodeId: USERS_ID,
      loadGeneration: 5,
    })
  })
})
