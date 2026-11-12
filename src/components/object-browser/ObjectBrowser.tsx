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
import { openObjectDefaultTab } from '../../lib/object-activation'
import { useObjectBrowserActions } from '../../hooks/useObjectBrowserActions'
import { usePinnedDatabase } from '../../hooks/usePinnedDatabase'
import type { CopyObjectSelection } from '../../lib/copy-to-host-commands'
import { TextInput } from '../common/TextInput'
import { IconButton } from '../common/IconButton'
import { ConnectionHeader } from './ConnectionHeader'
import { TreeNode } from './TreeNode'
import { ObjectBrowserContextMenu } from './ObjectBrowserContextMenu'
import type { NodeType, ObjectType, TreeNode as SchemaTreeNode } from '../../types/schema'
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

type TreeNodeMap = Record<string, SchemaTreeNode>
type ActiveConnectionState = ReturnType<
  typeof useConnectionStore.getState
>['activeConnections'][string]

const EDITABLE_TARGET_SELECTOR = 'input, textarea, [contenteditable="true"]'

function columnScopeRoot(columnNode: SchemaTreeNode, nodes: TreeNodeMap | null): string | null {
  return nodes?.[columnNode.parentId ?? '']?.parentId ?? null
}

function databaseScopeRoot(databaseNode: SchemaTreeNode, nodes: TreeNodeMap | null): string {
  const dbName = databaseNode.databaseName ?? parseNodeId(databaseNode.id).database
  const tableCategoryId = makeNodeId('category', dbName, 'table')
  return nodes?.[tableCategoryId] ? tableCategoryId : databaseNode.id
}

function filterScopeRootFor(selectedNode: SchemaTreeNode | null, nodes: TreeNodeMap | null) {
  if (!selectedNode) return null
  if (SCHEMA_OBJECT_TYPES.has(selectedNode.type)) return selectedNode.parentId ?? null
  if (selectedNode.type === 'column') return columnScopeRoot(selectedNode, nodes)
  if (selectedNode.type === 'database') return databaseScopeRoot(selectedNode, nodes)
  return selectedNode.id
}

function hasCommandModifier(event: React.KeyboardEvent): boolean {
  return event.ctrlKey || event.altKey || event.metaKey
}

function isEditableTarget(target: HTMLElement | null): boolean {
  if (!target) return true
  return target.closest(EDITABLE_TARGET_SELECTOR) !== null
}

function shouldIgnoreTreeKey(event: React.KeyboardEvent<HTMLDivElement>): boolean {
  if (event.defaultPrevented || hasCommandModifier(event)) return true
  return isEditableTarget(event.target as HTMLElement | null)
}

function typeAheadFilterValue(key: string, filterText: string): string | null {
  if (key === 'Backspace') return filterText.slice(0, -1)
  const isPrintableCharacter = key.length === 1 && !/\s/.test(key)
  if (!isPrintableCharacter) return null
  return `${filterText}${key}`
}

function selectedDatabaseName(
  selectedNode: SchemaTreeNode | null,
  selectedNodeId: string | null
): string | null {
  const databaseName = selectedNode?.databaseName
  if (databaseName != null) return databaseName
  if (!selectedNodeId) return null
  return parseNodeId(selectedNodeId).database
}

function isReadOnlyConnection(activeConnection: ActiveConnectionState | null): boolean {
  return activeConnection?.profile?.readOnly ?? false
}

function currentRevealSeq(): number {
  return useSchemaStore.getState().revealRequest?.seq ?? 0
}

interface ObjectTreeBodyProps {
  isConnected: boolean
  topLevelIds: string[]
  children: React.ReactNode
}

function ObjectTreeBody({ isConnected, topLevelIds, children }: ObjectTreeBodyProps) {
  if (!isConnected) return <div className={styles.emptyState}>Not connected</div>
  if (topLevelIds.length === 0) return <div className={styles.emptyState}>No databases loaded</div>
  return (
    <div role="tree" aria-label="Database objects">
      {children}
    </div>
  )
}

interface CopyToHostDialogHostProps {
  dialog: CopyToHostDialogState
  connectionId: string
  activeConnection: ActiveConnectionState | null
  onClose: () => void
}

function CopyToHostDialogHost({
  dialog,
  connectionId,
  activeConnection,
  onClose,
}: CopyToHostDialogHostProps) {
  const profile = activeConnection?.profile
  if (!dialog.open || !dialog.database || !profile) return null
  return (
    <Suspense fallback={null}>
      <CopyToHostDialog
        isOpen
        onClose={onClose}
        sourceConnectionId={connectionId}
        sourceConnectionLabel={profile.name}
        sourceDatabase={dialog.database}
        preSelectedObject={dialog.objectSelection}
      />
    </Suspense>
  )
}

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
  const revealRequest = useSchemaStore((state) => state.revealRequest)

  const [treeScrollElement, setTreeScrollElement] = useState<HTMLDivElement | null>(null)
  const pinnedDatabaseId = usePinnedDatabase(treeScrollElement)

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(CLOSED_MENU)
  const [dumpDialog, setDumpDialog] = useState<SqlDumpDialogState>(CLOSED_DUMP_DIALOG)
  const [copyToHostDialog, setCopyToHostDialog] = useState<CopyToHostDialogState>(
    CLOSED_COPY_TO_HOST_DIALOG
  )

  const isReadOnly = isReadOnlyConnection(activeConnection)
  const connectionStatus = activeConnection?.status

  // Dialog/action orchestration (Simplification 3)
  const actions = useObjectBrowserActions(connectionId)

  // Load databases on mount when connected
  useEffect(() => {
    if (connectionStatus === 'connected') {
      void loadDatabases(connectionId)
    }
  }, [connectionId, connectionStatus, loadDatabases])

  const handleNodeSelect = useCallback(
    (nodeId: string) => {
      if (connectionStatus !== 'connected' || !nodes) return

      const node = nodes[nodeId]
      if (!node) return

      const selectedDatabase = node.databaseName ?? parseNodeId(nodeId).database
      if (!selectedDatabase) return

      void setActiveDatabase(connectionId, selectedDatabase)
    },
    [connectionStatus, connectionId, nodes, setActiveDatabase]
  )

  // Use childIdsByParentId index for top-level nodes (Simplification 4)
  const topLevelIds = useMemo(() => {
    if (!childIdsByParentId) return []
    return childIdsByParentId['__root__'] ?? []
  }, [childIdsByParentId])

  const effectiveScopeRoot = useMemo(
    () => filterScopeRootFor(selectedNode, nodes),
    [nodes, selectedNode]
  )

  // Clear filter when scope (selected database) changes *within the same
  // connection*. The single ObjectBrowser instance is reused across connection
  // tabs (only the connectionId prop changes), so we must reset the tracked
  // scope when the connection changes — otherwise switching tabs is mistaken
  // for a scope change and wipes the newly-active connection's restored filter.
  const previousScopeRootRef = useRef<string | null | undefined>(undefined)
  const previousConnectionIdRef = useRef<string | null>(null)
  useEffect(() => {
    const connectionChanged = previousConnectionIdRef.current !== connectionId
    previousConnectionIdRef.current = connectionId

    if (connectionChanged || previousScopeRootRef.current === undefined) {
      previousScopeRootRef.current = effectiveScopeRoot
      return
    }
    if (previousScopeRootRef.current !== effectiveScopeRoot) {
      previousScopeRootRef.current = effectiveScopeRoot
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

  const handleFilterChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFilter(event.target.value, connectionId)
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
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (shouldIgnoreTreeKey(event)) {
        return
      }

      if (event.key === 'F5') {
        event.preventDefault()
        const dbName = selectedDatabaseName(selectedNode, selectedNodeId)
        if (dbName) {
          void refreshDatabase(connectionId, dbName)
        }
        return
      }

      const nextValue = typeAheadFilterValue(event.key, filterText)
      if (nextValue === null) {
        return
      }

      event.preventDefault()
      setFilter(nextValue, connectionId)
      filterInputRef.current?.focus()
    },
    [connectionId, filterText, setFilter, selectedNode, selectedNodeId, refreshDatabase]
  )

  // ---------------------------------------------------------------------------
  // Pinned database row and reveal requests
  // ---------------------------------------------------------------------------

  /** Scroll a pinned database row back to its real position at the top of its section. */
  const handleRevealPinned = useCallback(
    (nodeId: string) => {
      if (!treeScrollElement) return
      const section = Array.from(
        treeScrollElement.querySelectorAll<HTMLElement>('[data-database-section]')
      ).find((element) => element.dataset.databaseSection === nodeId)
      if (!section) return

      const delta =
        section.getBoundingClientRect().top - treeScrollElement.getBoundingClientRect().top
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      treeScrollElement.scrollTo({
        top: treeScrollElement.scrollTop + delta,
        behavior: reduceMotion ? 'auto' : 'smooth',
      })
    },
    [treeScrollElement]
  )

  // Scroll to and focus the node named by the latest reveal request for this
  // connection. Clears the filter first when it hides the node.
  // Start from the current seq so a freshly mounted browser does not replay an old request.
  const handledRevealSeqRef = useRef(currentRevealSeq())
  useEffect(() => {
    if (!revealRequest || revealRequest.connectionId !== connectionId || !treeScrollElement) return
    if (revealRequest.seq <= handledRevealSeqRef.current) return

    const row = Array.from(
      treeScrollElement.querySelectorAll<HTMLElement>('[role="treeitem"]')
    ).find((element) => element.dataset.testid === `tree-node-${revealRequest.nodeId}`)
    if (!row) {
      if (filterText) {
        setFilter('', connectionId)
      }
      return
    }

    handledRevealSeqRef.current = revealRequest.seq
    row.scrollIntoView({ block: 'nearest' })

    // Focus the row so arrow keys work straight away, but hide the focus ring
    // that the keyboard shortcut would otherwise trigger. It comes back on the
    // next key press in the tree, or once the row loses focus.
    row.dataset.suppressFocusRing = 'true'
    const restoreFocusRing = () => {
      delete row.dataset.suppressFocusRing
      row.removeEventListener('keydown', restoreFocusRing)
      row.removeEventListener('blur', restoreFocusRing)
    }
    row.addEventListener('keydown', restoreFocusRing)
    row.addEventListener('blur', restoreFocusRing)
    row.focus({ preventScroll: true })
  }, [revealRequest, connectionId, treeScrollElement, filterText, setFilter, nodes, selectedNodeId])

  // ---------------------------------------------------------------------------
  // Context menu handlers
  // ---------------------------------------------------------------------------

  const handleContextMenu = useCallback((event: React.MouseEvent, nodeId: string) => {
    event.preventDefault()
    dispatchDismissAll()
    requestAnimationFrame(() => {
      setContextMenu({ visible: true, x: event.clientX, y: event.clientY, nodeId: nodeId })
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
        databaseName: databaseName,
        connectionId: connectionId,
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
        databaseName: databaseName,
        connectionId: connectionId,
        label: 'New table',
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
    (databaseName: string, objectSelection?: CopyObjectSelection) => {
      setCopyToHostDialog({
        open: true,
        database: databaseName,
        objectSelection: objectSelection,
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

      if (!['table', 'view', 'procedure', 'function', 'trigger', 'event'].includes(node.type)) {
        return
      }

      const dbName = node.databaseName ?? parseNodeId(nodeId).database
      openObjectDefaultTab(connectionId, dbName, node.type as ObjectType, node.label, node.label)
    },
    [connectionId, nodes]
  )

  const isConnected = connectionStatus === 'connected'

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
              <MagnifyingGlass size={16} weight="regular" />
            </span>
            <TextInput
              ref={filterInputRef}
              type="text"
              className={styles.searchInput}
              placeholder="Filter objects"
              value={filterText}
              onChange={handleFilterChange}
              data-testid="filter-input"
              aria-label="Filter objects"
            />
            {filterText && (
              <IconButton
                size="sm"
                className={styles.clearButton}
                onClick={handleClearFilter}
                tabIndex={-1}
                aria-label="Clear filter"
                data-testid="filter-clear-button"
              >
                <X size={16} weight="regular" />
              </IconButton>
            )}
          </div>

          <div
            ref={setTreeScrollElement}
            className={styles.treeContainer}
            data-testid="object-browser-scroll"
            onKeyDownCapture={handleTreeKeyDownCapture}
          >
            <ObjectTreeBody isConnected={isConnected} topLevelIds={topLevelIds}>
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
                  isPinned={nodeId === pinnedDatabaseId}
                  onRevealPinned={handleRevealPinned}
                />
              ))}
            </ObjectTreeBody>
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

      <CopyToHostDialogHost
        dialog={copyToHostDialog}
        connectionId={connectionId}
        activeConnection={activeConnection}
        onClose={handleCloseCopyToHostDialog}
      />
    </div>
  )
}
