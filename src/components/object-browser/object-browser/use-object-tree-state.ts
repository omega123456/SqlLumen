import { useEffect, useMemo, useRef } from 'react'
import { useSchemaStore, type ConnectionTreeState } from '../../../stores/schema-store'
import { computeScopedFilterMatchIds } from '../../../lib/tree-filter'
import { isBlank } from '../../../lib/value-checks'
import { filterScopeRootFor, visibleTopLevelIdsFor } from './object-browser-model'

const ROOT_PARENT_ID = '__root__'

function connectionTreeOf(
  state: ReturnType<typeof useSchemaStore.getState>,
  connectionId: string
): ConnectionTreeState | undefined {
  return state.connectionStates[connectionId]
}

function useConnectionTree(connectionId: string) {
  const filterText = useSchemaStore(
    (state) => connectionTreeOf(state, connectionId)?.filterText ?? ''
  )
  const nodes = useSchemaStore((state) => connectionTreeOf(state, connectionId)?.nodes ?? null)
  const selectedNodeId = useSchemaStore(
    (state) => connectionTreeOf(state, connectionId)?.selectedNodeId ?? null
  )
  const childIdsByParentId = useSchemaStore(
    (state) => connectionTreeOf(state, connectionId)?.childIdsByParentId ?? null
  )
  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null
    return nodes?.[selectedNodeId] ?? null
  }, [nodes, selectedNodeId])
  const topLevelIds = useMemo(() => {
    if (!childIdsByParentId) return []
    return childIdsByParentId[ROOT_PARENT_ID] ?? []
  }, [childIdsByParentId])
  return { filterText, nodes, selectedNodeId, selectedNode, topLevelIds }
}

function useClearFilterOnScopeChange(connectionId: string, scopeRoot: string | null): void {
  const setFilter = useSchemaStore((state) => state.setFilter)
  const previousScopeRootRef = useRef<string | null | undefined>(undefined)
  const previousConnectionIdRef = useRef<string | null>(null)
  useEffect(() => {
    const connectionChanged = previousConnectionIdRef.current !== connectionId
    previousConnectionIdRef.current = connectionId

    const isFirstScopeForConnection =
      connectionChanged || previousScopeRootRef.current === undefined
    if (isFirstScopeForConnection) {
      previousScopeRootRef.current = scopeRoot
      return
    }
    if (previousScopeRootRef.current !== scopeRoot) {
      previousScopeRootRef.current = scopeRoot
      setFilter('', connectionId)
    }
  }, [scopeRoot, connectionId, setFilter])
}

type TreeState = ReturnType<typeof useConnectionTree>

function useLoadFilterScope(connectionId: string, tree: TreeState, scopeRoot: string | null) {
  const loadChildren = useSchemaStore((state) => state.loadChildren)
  const { filterText, nodes } = tree
  useEffect(() => {
    if (isBlank(filterText)) return
    if (!scopeRoot) return
    if (!nodes) return
    const scopeNode = nodes[scopeRoot]
    if (!scopeNode) return
    const isUnloadedCategory = scopeNode.type === 'category' && !scopeNode.isLoaded
    if (!isUnloadedCategory) return
    void loadChildren(connectionId, scopeRoot)
  }, [filterText, scopeRoot, nodes, connectionId, loadChildren])
}

export function useObjectTreeState(connectionId: string) {
  const tree = useConnectionTree(connectionId)
  const { filterText, nodes, selectedNode, topLevelIds } = tree
  const effectiveScopeRoot = useMemo(
    () => filterScopeRootFor(selectedNode, nodes),
    [nodes, selectedNode]
  )
  useClearFilterOnScopeChange(connectionId, effectiveScopeRoot)
  useLoadFilterScope(connectionId, tree, effectiveScopeRoot)

  const filterMatchIds = useMemo(() => {
    const trimmed = filterText.trim()
    if (!trimmed) return undefined
    if (!nodes) return undefined
    return computeScopedFilterMatchIds(nodes, trimmed, effectiveScopeRoot)
  }, [filterText, nodes, effectiveScopeRoot])

  const visibleTopLevelIds = useMemo(
    () =>
      visibleTopLevelIdsFor({
        nodes: nodes,
        topLevelIds: topLevelIds,
        filterMatchIds: filterMatchIds,
        scopeRoot: effectiveScopeRoot,
      }),
    [nodes, filterMatchIds, topLevelIds, effectiveScopeRoot]
  )

  return { ...tree, effectiveScopeRoot, filterMatchIds, visibleTopLevelIds }
}

export type ObjectTreeState = ReturnType<typeof useObjectTreeState>
