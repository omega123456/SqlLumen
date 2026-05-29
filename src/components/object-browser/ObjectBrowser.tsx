import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import {
  useSchemaStore,
  parseNodeId,
  makeNodeId,
  type ConnectionTreeState,
} from '../../stores/schema-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useConnectionStore } from '../../stores/connection-store'
import { dispatchDismissAll } from '../../lib/context-menu-events'
import { useObjectBrowserActions } from '../../hooks/useObjectBrowserActions'
import type { CopyObjectSelection } from '../../lib/copy-to-host-commands'
import { TextInput } from '../common/TextInput'
import { ConnectionHeader } from './ConnectionHeader'
import { TreeNode } from './TreeNode'
import { ObjectBrowserContextMenu } from './ObjectBrowserContextMenu'
import type { NodeType, ObjectType } from '../../types/schema'
import { computeScopedFilterMatchIds, isNodeUnderFilterScope } from '../../lib/tree-filter'
import { FavouritesView } from '../favourites/FavouritesView'
import styles from './ObjectBrowser.module.css'

const SqlDumpDialog = lazy(() => import('../dialogs/SqlDumpDialog'))
const CopyToHostDialog = lazy(() => import('../dialogs/CopyToHostDialog'))

export interface ObjectBrowserProps {
  connectionId: string
  favouritesOpen: boolean
  onToggleFavourites: () => void
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

const SCHEMA_OBJECT_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  'table',
  'view',
  'procedure',
  'function',
  'trigger',
  'event',
])

// ---------------------------------------------------------------------------
// SQL dump dialog state
// ---------------------------------------------------------------------------

interface SqlDumpDialogState {
  open: boolean
  database?: string
  table?: string
  schemaOnly?: boolean
}

const CLOSED_DUMP_DIALOG: SqlDumpDialogState = { open: false }

interface CopyToHostDialogState {
  open: boolean
  database?: string
  objectSelection?: CopyObjectSelection
}

const CLOSED_COPY_TO_HOST_DIALOG: CopyToHostDialogState = { open: false }

export function ObjectBrowser({
  connectionId,
  favouritesOpen,
  onToggleFavourites,
}: ObjectBrowserProps) {
  const filterInputRef = useRef<HTMLInputElement>(null)
  const setActiveDatabase = useConnectionStore((state) => state.setActiveDatabase)
  const activeConnection = useConnectionStore(
    (state) => state.activeConnections[connectionId] ?? null
  )
  const loadDatabases = useSchemaStore((state) => state.loadDatabases)
  const loadChildren = useSchemaStore((state) => state.loadChildren)
  const refreshDatabase = useSchemaStore((state) => state.refreshDatabase)
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
  const selectedNode = useMemo(
    () => (selectedNodeId && nodes?.[selectedNodeId] ? nodes[selectedNodeId] : null),
    [nodes, selectedNodeId]
  )
  const childIdsByParentId = useSchemaStore(
    (state) =>
      (state.connectionStates[connectionId] as ConnectionTreeState | undefined)
        ?.childIdsByParentId ?? null
  )
  const openTab = useWorkspaceStore((state) => state.openTab)

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(CLOSED_MENU)
  const [dumpDialog, setDumpDialog] = useState<SqlDumpDialogState>(CLOSED_DUMP_DIALOG)
  const [copyToHostDialog, setCopyToHostDialog] =
    useState<CopyToHostDialogState>(CLOSED_COPY_TO_HOST_DIALOG)

  const isReadOnly = activeConnection?.profile?.readOnly ?? false

  // Dialog/action orchestration (Simplification 3)
  const actions = useObjectBrowserActions(connectionId)

  // Load databases on mount when connected
  useEffect(() => {
    if (activeConnection?.status === 'connected') {
      void loadDatabases(connectionId)
    }
  }, [connectionId, activeConnection?.status, loadDatabases])

  const handleNodeSelect = useCallback(
    (nodeId: string) => {
      if (activeConnection?.status !== 'connected' || !nodes) return

      const node = nodes[nodeId]
      if (!node) return

      const selectedDatabase = node.databaseName ?? parseNodeId(nodeId).database
      if (!selectedDatabase) return

      void setActiveDatabase(connectionId, selectedDatabase)
    },
    [activeConnection?.status, connectionId, nodes, setActiveDatabase]
  )

  // Use childIdsByParentId index for top-level nodes (Simplification 4)
  const topLevelIds = useMemo(() => {
    if (!childIdsByParentId) return []
    return childIdsByParentId['__root__'] ?? []
  }, [childIdsByParentId])

  const effectiveScopeRoot = useMemo(() => {
    if (!selectedNode) {
      return null
    }

    if (SCHEMA_OBJECT_TYPES.has(selectedNode.type)) {
      return selectedNode.parentId ?? null
    }

    if (selectedNode.type === 'column') {
      return nodes?.[selectedNode.parentId ?? '']?.parentId ?? null
    }

    if (selectedNode.type === 'database') {
      const dbName = selectedNode.databaseName ?? parseNodeId(selectedNode.id).database
      const tableCatId = makeNodeId('category', dbName, 'table')
      return nodes?.[tableCatId] ? tableCatId : selectedNode.id
    }

    return selectedNode.id
  }, [nodes, selectedNode])

  // Clear filter when scope (selected database) changes *within the same
  // connection*. The single ObjectBrowser instance is reused across connection
  // tabs (only the connectionId prop changes), so we must reset the tracked
  // scope when the connection changes — otherwise switching tabs is mistaken
  // for a scope change and wipes the newly-active connection's restored filter.
  const prevScopeRootRef = useRef<string | null | undefined>(undefined)
  const prevConnectionIdRef = useRef<string | null>(null)
  useEffect(() => {
    const connectionChanged = prevConnectionIdRef.current !== connectionId
    prevConnectionIdRef.current = connectionId

    if (connectionChanged || prevScopeRootRef.current === undefined) {
      prevScopeRootRef.current = effectiveScopeRoot
      return
    }
    if (prevScopeRootRef.current !== effectiveScopeRoot) {
      prevScopeRootRef.current = effectiveScopeRoot
      setFilter('', connectionId)
    }
  }, [effectiveScopeRoot, connectionId, setFilter])

  useEffect(() => {
    if (!filterText.trim() || !effectiveScopeRoot || !nodes) return
    const scopeNode = nodes[effectiveScopeRoot]
    if (!scopeNode || scopeNode.type !== 'category' || scopeNode.isLoaded) return
    void loadChildren(connectionId, effectiveScopeRoot)
  }, [filterText, effectiveScopeRoot, nodes, connectionId, loadChildren])

  const filterMatchIds = useMemo(() => {
    const trimmed = filterText.trim()
    if (!trimmed || !nodes) {
      return undefined
    }
    return computeScopedFilterMatchIds(nodes, trimmed, effectiveScopeRoot)
  }, [filterText, nodes, effectiveScopeRoot])

  const visibleTopLevelIds = useMemo(() => {
    if (!nodes || !filterMatchIds) {
      return topLevelIds
    }

    return topLevelIds.filter((nodeId) => {
      const node = nodes[nodeId]
      if (!node) {
        return false
      }

      if (effectiveScopeRoot == null) {
        return filterMatchIds.has(nodeId)
      }

      return (
        !isNodeUnderFilterScope(nodeId, effectiveScopeRoot, nodes) || filterMatchIds.has(nodeId)
      )
    })
  }, [nodes, filterMatchIds, topLevelIds, effectiveScopeRoot])

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilter(e.target.value, connectionId)
  }

  const ensurePathExpanded = useSchemaStore((state) => state.ensurePathExpanded)
  const handleClearFilter = useCallback(() => {
    if (effectiveScopeRoot && filterText.trim()) {
      ensurePathExpanded(connectionId, effectiveScopeRoot)
    }
    setFilter('', connectionId)
    filterInputRef.current?.focus()
  }, [connectionId, setFilter, effectiveScopeRoot, filterText, ensurePathExpanded])

  const handleTreeKeyDownCapture = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) {
        return
      }

      const target = e.target as HTMLElement | null
      if (!target || target.closest('input, textarea, [contenteditable="true"]')) {
        return
      }

      if (e.key === 'F5') {
        e.preventDefault()
        const dbName =
          selectedNode?.databaseName ??
          (selectedNodeId ? parseNodeId(selectedNodeId).database : null)
        if (dbName) {
          void refreshDatabase(connectionId, dbName)
        }
        return
      }

      const isPrintableCharacter = e.key.length === 1 && !/\s/.test(e.key)
      const isBackspace = e.key === 'Backspace'

      if (!isPrintableCharacter && !isBackspace) {
        return
      }

      e.preventDefault()

      const nextValue = isBackspace ? filterText.slice(0, -1) : `${filterText}${e.key}`
      setFilter(nextValue, connectionId)
      filterInputRef.current?.focus()
    },
    [connectionId, filterText, setFilter, selectedNode, selectedNodeId, refreshDatabase]
  )

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

  const handleDesignTable = useCallback(
    (databaseName: string, tableName: string) => {
      openTab({
        type: 'table-designer',
        mode: 'alter',
        objectName: tableName,
        databaseName,
        connectionId,
        label: tableName,
      })
    },
    [connectionId, openTab]
  )

  const handleCreateTable = useCallback(
    (databaseName: string) => {
      openTab({
        type: 'table-designer',
        mode: 'create',
        objectName: '__new_table__',
        databaseName,
        connectionId,
        label: 'New Table',
      })
    },
    [connectionId, openTab]
  )

  // ---------------------------------------------------------------------------
  // SQL dump dialog handlers
  // ---------------------------------------------------------------------------

  const handleExportDump = useCallback((databaseName: string, tableName?: string) => {
    setDumpDialog({ open: true, database: databaseName, table: tableName, schemaOnly: false })
  }, [])

  const handleExportDdl = useCallback((databaseName: string, tableName?: string) => {
    setDumpDialog({ open: true, database: databaseName, table: tableName, schemaOnly: true })
  }, [])

  const handleCloseDumpDialog = useCallback(() => {
    setDumpDialog(CLOSED_DUMP_DIALOG)
  }, [])

  const handleCopyToHost = useCallback(
    (
      databaseName: string,
      objectSelection?: CopyObjectSelection
    ) => {
      setCopyToHostDialog({
        open: true,
        database: databaseName,
        objectSelection,
      })
    },
    []
  )

  const handleCloseCopyToHostDialog = useCallback(() => {
    setCopyToHostDialog(CLOSED_COPY_TO_HOST_DIALOG)
  }, [])

  // ---------------------------------------------------------------------------
  // Object activation handler — uses node.databaseName (Simplification 5)
  // ---------------------------------------------------------------------------

  const handleActivateNode = useCallback(
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
          openTab({
            type: 'table-data',
            label: node.label,
            connectionId,
            databaseName: dbName,
            objectName: node.label,
            objectType: 'view' as ObjectType,
          })
          break
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
      <ConnectionHeader
        connectionId={connectionId}
        favouritesOpen={favouritesOpen}
        onToggleFavourites={onToggleFavourites}
      />

      {favouritesOpen ? (
        <FavouritesView connectionId={connectionId} />
      ) : (
        <>
          <div className={styles.searchWrapper}>
            <span className={styles.searchIcon}>
              <MagnifyingGlass size={14} weight="regular" />
            </span>
            <TextInput
              ref={filterInputRef}
              variant="bare"
              type="text"
              className={styles.searchInput}
              placeholder="Filter objects..."
              value={filterText}
              onChange={handleFilterChange}
              data-testid="filter-input"
              aria-label="Filter objects"
            />
            {filterText && (
              <button
                className={styles.clearButton}
                onClick={handleClearFilter}
                tabIndex={-1}
                aria-label="Clear filter"
                data-testid="filter-clear-button"
              >
                <X size={12} weight="bold" />
              </button>
            )}
          </div>

          <div
            className={styles.treeContainer}
            data-testid="object-browser-scroll"
            onKeyDownCapture={handleTreeKeyDownCapture}
          >
            {!isConnected && <div className={styles.emptyState}>Not connected</div>}

            {isConnected && !hasNodes && (
              <div className={styles.emptyState}>No databases loaded</div>
            )}

            {isConnected && hasNodes && (
              <div role="tree" aria-label="Database objects">
                {visibleTopLevelIds.map((nodeId, index) => (
                  <TreeNode
                    key={nodeId}
                    nodeId={nodeId}
                    connectionId={connectionId}
                    level={0}
                    onContextMenu={handleContextMenu}
                    onActivate={handleActivateNode}
                    onSelect={handleNodeSelect}
                    filterMatchIds={filterMatchIds}
                    filterScopeRootId={effectiveScopeRoot}
                    onClearFilter={handleClearFilter}
                    isFirstVisible={index === 0}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

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
        onDesignTable={handleDesignTable}
        onCreateTable={handleCreateTable}
        onAlterObject={actions.onAlterObject}
        onDropObject={actions.onDropObject}
        onCreateObject={actions.onCreateObject}
        onExecuteRoutine={actions.onExecuteRoutine}
        onExportDump={handleExportDump}
        onExportDdl={handleExportDdl}
        onCopyToHost={handleCopyToHost}
      />

      {actions.dialogs}

      {dumpDialog.open && (
        <Suspense fallback={null}>
          <SqlDumpDialog
            connectionId={connectionId}
            initialDatabase={dumpDialog.database}
            initialTable={dumpDialog.table}
            schemaOnly={dumpDialog.schemaOnly}
            onClose={handleCloseDumpDialog}
          />
        </Suspense>
      )}

      {copyToHostDialog.open && copyToHostDialog.database && activeConnection?.profile && (
        <Suspense fallback={null}>
          <CopyToHostDialog
            isOpen
            onClose={handleCloseCopyToHostDialog}
            sourceConnectionId={connectionId}
            sourceConnectionLabel={activeConnection.profile.name}
            sourceDatabase={copyToHostDialog.database}
            preSelectedObject={copyToHostDialog.objectSelection}
          />
        </Suspense>
      )}
    </div>
  )
}
