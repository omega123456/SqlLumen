import { useCallback, useEffect, useMemo, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { useSchemaStore, parseNodeId, type ConnectionTreeState } from '../../stores/schema-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useConnectionStore } from '../../stores/connection-store'
import { dispatchDismissAll } from '../../lib/context-menu-events'
import { useObjectBrowserActions } from '../../hooks/useObjectBrowserActions'
import { ConnectionHeader } from './ConnectionHeader'
import { TreeNode } from './TreeNode'
import { ObjectBrowserContextMenu } from './ObjectBrowserContextMenu'
import type { ObjectType } from '../../types/schema'
import { computeScopedFilterMatchIds } from '../../lib/tree-filter'
import styles from './ObjectBrowser.module.css'

export interface ObjectBrowserProps {
  connectionId: string
}

// ---------------------------------------------------------------------------
// Context menu state
// ---------------------------------------------------------------------------

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  nodeId: string | null
}

const CLOSED_MENU: ContextMenuState = { visible: false, x: 0, y: 0, nodeId: null }

export function ObjectBrowser({ connectionId }: ObjectBrowserProps) {
  const activeConnection = useConnectionStore(
    (state) => state.activeConnections[connectionId] ?? null
  )
  const loadDatabases = useSchemaStore((state) => state.loadDatabases)
  const setFilter = useSchemaStore((state) => state.setFilter)
  const filterText = useSchemaStore(
    (state) =>
      (state.connectionStates[connectionId] as ConnectionTreeState | undefined)?.filterText ?? ''
  )
  const nodes = useSchemaStore(
    (state) =>
      (state.connectionStates[connectionId] as ConnectionTreeState | undefined)?.nodes ?? null
  )
  const selectedNodeId = useSchemaStore(
    (state) =>
      (state.connectionStates[connectionId] as ConnectionTreeState | undefined)?.selectedNodeId ??
      null
  )
  const childIdsByParentId = useSchemaStore(
    (state) =>
      (state.connectionStates[connectionId] as ConnectionTreeState | undefined)
        ?.childIdsByParentId ?? null
  )
  const openTab = useWorkspaceStore((state) => state.openTab)

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(CLOSED_MENU)

  const isReadOnly = activeConnection?.profile?.readOnly ?? false

  // Dialog/action orchestration (Simplification 3)
  const actions = useObjectBrowserActions(connectionId)

  // Load databases on mount when connected
  useEffect(() => {
    if (activeConnection?.status === 'connected') {
      void loadDatabases(connectionId)
    }
  }, [connectionId, activeConnection?.status, loadDatabases])

  // Use childIdsByParentId index for top-level nodes (Simplification 4)
  const topLevelIds = useMemo(() => {
    if (!childIdsByParentId) return []
    return childIdsByParentId['__root__'] ?? []
  }, [childIdsByParentId])

  const effectiveScopeRoot =
    selectedNodeId && nodes?.[selectedNodeId] ? selectedNodeId : null

  const filterMatchIds = useMemo(() => {
    const trimmed = filterText.trim()
    if (!trimmed || !nodes) {
      return undefined
    }
    return computeScopedFilterMatchIds(nodes, trimmed, effectiveScopeRoot)
  }, [filterText, nodes, effectiveScopeRoot])

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilter(e.target.value, connectionId)
  }

  // ---------------------------------------------------------------------------
  // Context menu handlers
  // ---------------------------------------------------------------------------

  const handleContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault()
    dispatchDismissAll()
    requestAnimationFrame(() => {
      setContextMenu({ visible: true, x: e.clientX, y: e.clientY, nodeId })
    })
  }, [])

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(CLOSED_MENU)
  }, [])

  // ---------------------------------------------------------------------------
  // Double-click handler — uses node.databaseName (Simplification 5)
  // ---------------------------------------------------------------------------

  const handleDoubleClick = useCallback(
    (nodeId: string) => {
      if (!nodes) return
      const node = nodes[nodeId]
      if (!node) return

      // Use direct field if available, fall back to parseNodeId
      const dbName = node.databaseName ?? parseNodeId(nodeId).database

      switch (node.type) {
        case 'table':
          openTab({
            type: 'table-data',
            label: node.label,
            connectionId,
            databaseName: dbName,
            objectName: node.label,
            objectType: 'table' as ObjectType,
          })
          break
        case 'view':
        case 'procedure':
        case 'function':
        case 'trigger':
        case 'event':
          openTab({
            type: 'schema-info',
            label: node.label,
            connectionId,
            databaseName: dbName,
            objectName: node.label,
            objectType: node.type as ObjectType,
          })
          break
        default:
          break
      }
    },
    [connectionId, nodes, openTab]
  )

  const isConnected = activeConnection?.status === 'connected'
  const hasNodes = topLevelIds.length > 0

  return (
    <div className={styles.container} data-testid="object-browser">
      <ConnectionHeader connectionId={connectionId} />

      <div className={styles.searchWrapper}>
        <span className={styles.searchIcon}>
          <MagnifyingGlass size={14} weight="regular" />
        </span>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Filter objects..."
          value={filterText}
          onChange={handleFilterChange}
          data-testid="filter-input"
          aria-label="Filter objects"
        />
      </div>

      <div className={styles.treeContainer} data-testid="object-browser-scroll">
        {!isConnected && <div className={styles.emptyState}>Not connected</div>}

        {isConnected && !hasNodes && <div className={styles.emptyState}>No databases loaded</div>}

        {isConnected && hasNodes && (
          <div role="tree" aria-label="Database objects">
            {topLevelIds.map((nodeId, index) => (
              <TreeNode
                key={nodeId}
                nodeId={nodeId}
                connectionId={connectionId}
                level={0}
                onContextMenu={handleContextMenu}
                onDoubleClick={handleDoubleClick}
                filterMatchIds={filterMatchIds}
                filterScopeRootId={effectiveScopeRoot}
                isFirstVisible={index === 0}
              />
            ))}
          </div>
        )}
      </div>

      <ObjectBrowserContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        nodeId={contextMenu.nodeId}
        connectionId={connectionId}
        isReadOnly={isReadOnly}
        onClose={handleContextMenuClose}
        onCreateDatabase={actions.onCreateDatabase}
        onAlterDatabase={actions.onAlterDatabase}
        onRenameDatabase={actions.onRenameDatabase}
        onDropDatabase={actions.onDropDatabase}
        onDropTable={actions.onDropTable}
        onTruncateTable={actions.onTruncateTable}
        onRenameTable={actions.onRenameTable}
      />

      {actions.dialogs}
    </div>
  )
}
