import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { useSchemaStore } from '../../../stores/schema-store'
import { isBlank } from '../../../lib/value-checks'
import {
  currentRevealSeq,
  findElementByDataset,
  focusRowWithoutFocusRing,
  prefersReducedMotion,
  selectedDatabaseName,
  shouldIgnoreTreeKey,
  typeAheadFilterValue,
} from './object-browser-model'
import type { ObjectTreeState } from './use-object-tree-state'

interface TreeNavigationInput {
  connectionId: string
  tree: ObjectTreeState
  filterInputRef: RefObject<HTMLInputElement | null>
}

const REFRESH_KEY = 'F5'

export function useTreeFilterHandlers(input: TreeNavigationInput) {
  const { connectionId, tree, filterInputRef } = input
  const { filterText, effectiveScopeRoot, selectedNode, selectedNodeId } = tree
  const setFilter = useSchemaStore((state) => state.setFilter)
  const refreshDatabase = useSchemaStore((state) => state.refreshDatabase)
  const ensurePathExpanded = useSchemaStore((state) => state.ensurePathExpanded)

  const handleClearFilter = useCallback(() => {
    const hasActiveFilter = !isBlank(filterText)
    if (effectiveScopeRoot && hasActiveFilter) {
      ensurePathExpanded(connectionId, effectiveScopeRoot)
    }
    setFilter('', connectionId)
    filterInputRef.current?.focus()
  }, [connectionId, setFilter, effectiveScopeRoot, filterText, ensurePathExpanded, filterInputRef])

  const handleTreeKeyDownCapture = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (shouldIgnoreTreeKey(event)) return
      if (event.key === REFRESH_KEY) {
        event.preventDefault()
        const databaseName = selectedDatabaseName(selectedNode, selectedNodeId)
        if (databaseName) void refreshDatabase(connectionId, databaseName)
        return
      }
      const nextValue = typeAheadFilterValue(event.key, filterText)
      if (nextValue === null) return
      event.preventDefault()
      setFilter(nextValue, connectionId)
      filterInputRef.current?.focus()
    },
    [
      connectionId,
      filterText,
      setFilter,
      selectedNode,
      selectedNodeId,
      refreshDatabase,
      filterInputRef,
    ]
  )

  return {
    handleFilterChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setFilter(event.target.value, connectionId),
    handleClearFilter: handleClearFilter,
    handleTreeKeyDownCapture: handleTreeKeyDownCapture,
  }
}

export function useRevealPinned(treeScrollElement: HTMLDivElement | null) {
  return useCallback(
    (nodeId: string) => {
      if (!treeScrollElement) return
      const section = findElementByDataset(treeScrollElement, '[data-database-section]', {
        key: 'databaseSection',
        value: nodeId,
      })
      if (!section) return
      const delta =
        section.getBoundingClientRect().top - treeScrollElement.getBoundingClientRect().top
      treeScrollElement.scrollTo({
        top: treeScrollElement.scrollTop + delta,
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      })
    },
    [treeScrollElement]
  )
}

export function useRevealRequestedNode(
  connectionId: string,
  tree: ObjectTreeState,
  treeScrollElement: HTMLDivElement | null
): void {
  const { filterText, nodes, selectedNodeId } = tree
  const setFilter = useSchemaStore((state) => state.setFilter)
  const revealRequest = useSchemaStore((state) => state.revealRequest)
  const handledRevealSeqRef = useRef(currentRevealSeq())
  useEffect(() => {
    if (!revealRequest) return
    if (revealRequest.connectionId !== connectionId) return
    if (!treeScrollElement) return
    if (revealRequest.seq <= handledRevealSeqRef.current) return

    const row = findElementByDataset(treeScrollElement, '[role="treeitem"]', {
      key: 'testid',
      value: `tree-node-${revealRequest.nodeId}`,
    })
    if (!row) {
      if (filterText) setFilter('', connectionId)
      return
    }

    handledRevealSeqRef.current = revealRequest.seq
    row.scrollIntoView({ block: 'nearest' })
    focusRowWithoutFocusRing(row)
  }, [revealRequest, connectionId, treeScrollElement, filterText, setFilter, nodes, selectedNodeId])
}
