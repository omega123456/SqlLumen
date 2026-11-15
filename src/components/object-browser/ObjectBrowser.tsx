import { useCallback, useEffect, useRef, useState } from 'react'
import { parseNodeId } from '../../stores/schema-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useSchemaStore } from '../../stores/schema-store'
import { SCROLLBAR, joinClassNames } from '../../lib/class-names'
import { openObjectDefaultTab } from '../../lib/object-activation'
import { useObjectBrowserActions } from '../../hooks/useObjectBrowserActions'
import { usePinnedDatabase } from '../../hooks/usePinnedDatabase'
import { ConnectionHeader } from './ConnectionHeader'
import { TreeNode } from './TreeNode'
import type { ObjectType, TreeNode as SchemaTreeNode } from '../../types/schema'
import { FavouritesView } from '../favourites/FavouritesView'
import {
  isReadOnlyConnection,
  isSchemaObjectType,
  type ActiveConnectionState,
} from './object-browser/object-browser-model'
import {
  CopyToHostDialogHost,
  ObjectBrowserMenu,
  ObjectFilterBar,
  ObjectTreeBody,
  SqlDumpDialogHost,
} from './object-browser/ObjectBrowserParts'
import { useObjectBrowserMenus } from './object-browser/use-object-browser-menus'
import { useObjectTreeState, type ObjectTreeState } from './object-browser/use-object-tree-state'
import {
  useRevealPinned,
  useRevealRequestedNode,
  useTreeFilterHandlers,
} from './object-browser/use-tree-navigation'

export interface ObjectBrowserProps {
  connectionId: string
  favouritesOpen: boolean
  onToggleFavourites: () => void
}

type TreeNodeMap = Record<string, SchemaTreeNode>

function useNodeSelection(connectionId: string, nodes: TreeNodeMap | null, isConnected: boolean) {
  const setActiveDatabase = useConnectionStore((state) => state.setActiveDatabase)
  return useCallback(
    (nodeId: string) => {
      if (!isConnected) return
      const node = nodes?.[nodeId]
      if (!node) return
      const selectedDatabase = node.databaseName ?? parseNodeId(nodeId).database
      if (!selectedDatabase) return
      void setActiveDatabase(connectionId, selectedDatabase)
    },
    [connectionId, isConnected, nodes, setActiveDatabase]
  )
}

function useNodeActivation(connectionId: string, nodes: TreeNodeMap | null) {
  return useCallback(
    (nodeId: string) => {
      const node = nodes?.[nodeId]
      if (!node) return
      if (!isSchemaObjectType(node.type)) return
      openObjectDefaultTab({
        connectionId: connectionId,
        database: node.databaseName ?? parseNodeId(nodeId).database,
        objectType: node.type as ObjectType,
        name: node.label,
        label: node.label,
      })
    },
    [connectionId, nodes]
  )
}

function useLoadDatabasesWhenConnected(connectionId: string, isConnected: boolean): void {
  const loadDatabases = useSchemaStore((state) => state.loadDatabases)
  useEffect(() => {
    if (isConnected) void loadDatabases(connectionId)
  }, [connectionId, isConnected, loadDatabases])
}

function useTreeScroll(connectionId: string, tree: ObjectTreeState) {
  const [treeScrollElement, setTreeScrollElement] = useState<HTMLDivElement | null>(null)
  const pinnedDatabaseId = usePinnedDatabase(treeScrollElement)
  const handleRevealPinned = useRevealPinned(treeScrollElement)
  useRevealRequestedNode(connectionId, tree, treeScrollElement)
  return { setTreeScrollElement, pinnedDatabaseId, handleRevealPinned }
}

interface ObjectTreeProps {
  connectionId: string
  tree: ObjectTreeState
  isConnected: boolean
  filter: ReturnType<typeof useTreeFilterHandlers>
  pinned: Pick<ReturnType<typeof useTreeScroll>, 'pinnedDatabaseId' | 'handleRevealPinned'>
  treeContainerRef: (element: HTMLDivElement | null) => void
  onContextMenu: (event: React.MouseEvent, nodeId: string) => void
}

function ObjectTree(props: ObjectTreeProps) {
  const { connectionId, tree, isConnected, filter, pinned, treeContainerRef, onContextMenu } = props
  const handleNodeSelect = useNodeSelection(connectionId, tree.nodes, isConnected)
  const handleActivateNode = useNodeActivation(connectionId, tree.nodes)
  return (
    <div
      ref={treeContainerRef}
      className={joinClassNames([
        'flex-1 overflow-x-hidden overflow-y-auto px-1 pb-2 scroll-pt-tree-row',
        SCROLLBAR,
      ])}
      data-testid="object-browser-scroll"
      onKeyDownCapture={filter.handleTreeKeyDownCapture}
    >
      <ObjectTreeBody isConnected={isConnected} topLevelIds={tree.topLevelIds}>
        {tree.visibleTopLevelIds.map((nodeId, index) => (
          <TreeNode
            key={nodeId}
            nodeId={nodeId}
            connectionId={connectionId}
            level={0}
            onContextMenu={onContextMenu}
            onActivate={handleActivateNode}
            onSelect={handleNodeSelect}
            filterMatchIds={tree.filterMatchIds}
            filterScopeRootId={tree.effectiveScopeRoot}
            onClearFilter={filter.handleClearFilter}
            isFirstVisible={index === 0}
            isPinned={nodeId === pinned.pinnedDatabaseId}
            onRevealPinned={pinned.handleRevealPinned}
          />
        ))}
      </ObjectTreeBody>
    </div>
  )
}

interface ExportDialogHostsProps {
  connectionId: string
  activeConnection: ActiveConnectionState | null
  menus: ReturnType<typeof useObjectBrowserMenus>
}

function ExportDialogHosts({ connectionId, activeConnection, menus }: ExportDialogHostsProps) {
  return (
    <>
      <SqlDumpDialogHost
        dialog={menus.dumpDialog}
        connectionId={connectionId}
        onClose={menus.handleCloseDumpDialog}
      />
      <CopyToHostDialogHost
        dialog={menus.copyToHostDialog}
        connectionId={connectionId}
        activeConnection={activeConnection}
        onClose={menus.handleCloseCopyToHostDialog}
      />
    </>
  )
}

function ObjectBrowserFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-light-surface-container-low dark:bg-dark-surface-container-low"
      data-testid="object-browser"
    >
      {children}
    </div>
  )
}

export function ObjectBrowser({
  connectionId,
  favouritesOpen,
  onToggleFavourites,
}: ObjectBrowserProps) {
  const filterInputRef = useRef<HTMLInputElement>(null)
  const activeConnection = useConnectionStore(
    (state) => state.activeConnections[connectionId] ?? null
  )
  const isConnected = activeConnection?.status === 'connected'
  const tree = useObjectTreeState(connectionId)
  const filter = useTreeFilterHandlers({ connectionId, tree, filterInputRef })
  const { setTreeScrollElement, ...pinned } = useTreeScroll(connectionId, tree)
  const menus = useObjectBrowserMenus(connectionId)
  const actions = useObjectBrowserActions(connectionId)
  useLoadDatabasesWhenConnected(connectionId, isConnected)

  return (
    <ObjectBrowserFrame>
      <ConnectionHeader
        connectionId={connectionId}
        favouritesOpen={favouritesOpen}
        onToggleFavourites={onToggleFavourites}
      />
      {favouritesOpen ? (
        <FavouritesView connectionId={connectionId} />
      ) : (
        <>
          <ObjectFilterBar
            filterInputRef={filterInputRef}
            filterText={tree.filterText}
            onFilterChange={filter.handleFilterChange}
            onClearFilter={filter.handleClearFilter}
          />
          <ObjectTree
            connectionId={connectionId}
            tree={tree}
            isConnected={isConnected}
            filter={filter}
            pinned={pinned}
            treeContainerRef={setTreeScrollElement}
            onContextMenu={menus.handleContextMenu}
          />
        </>
      )}
      <ObjectBrowserMenu
        connectionId={connectionId}
        isReadOnly={isReadOnlyConnection(activeConnection)}
        menus={menus}
        actions={actions}
      />
      {actions.dialogs}
      <ExportDialogHosts
        connectionId={connectionId}
        activeConnection={activeConnection}
        menus={menus}
      />
    </ObjectBrowserFrame>
  )
}
