import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useDismissOnOutsideClick } from '../connection-dialog/useDismissOnOutsideClick'
import { logFrontend } from '../../lib/app-log-commands'
import {
  CONTEXT_MENU,
  CONTEXT_MENU_ICON,
  CONTEXT_MENU_SEPARATOR,
  contextMenuItemClassName,
} from '../../lib/class-names-menu'
import { dataFlag } from '../../lib/data-attributes'
import { clampContextMenuPosition, writeClipboardText } from '../../lib/context-menu-utils'
import { DISMISS_ALL_CONTEXT_MENUS } from '../../lib/context-menu-events'
import type { CopyObjectSelection } from '../../lib/copy-to-host-commands'
import { parseNodeId, useSchemaStore, type ConnectionTreeState } from '../../stores/schema-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type { NodeType, ObjectType, EditableObjectType, TreeNode } from '../../types/schema'
import { Button } from '../common/Button'
import { buildMenuEntries } from './context-menu/build-menu-entries'
import {
  cleanSeparators,
  isSeparator,
  type BuildMenuArgs,
  type MenuEntry,
} from './context-menu/menu-entry-types'

export interface ObjectBrowserContextMenuProps {
  visible: boolean
  x: number
  y: number
  nodeId: string | null
  connectionId: string
  isReadOnly: boolean
  onClose: () => void
  onCreateDatabase?: () => void
  onAlterDatabase?: (databaseName: string) => void
  onRenameDatabase?: (databaseName: string) => void
  onDropDatabase?: (databaseName: string) => void
  onDropTable?: (databaseName: string, tableName: string) => void
  onTruncateTable?: (databaseName: string, tableName: string) => void
  onRenameTable?: (databaseName: string, tableName: string) => void
  onDesignTable?: (databaseName: string, tableName: string) => void
  onCreateTable?: (databaseName: string) => void
  onAlterObject?: (databaseName: string, objectName: string, objectType: EditableObjectType) => void
  onDropObject?: (databaseName: string, objectName: string, objectType: EditableObjectType) => void
  onCreateObject?: (databaseName: string, objectType: EditableObjectType) => void
  onExecuteRoutine?: (
    databaseName: string,
    routineName: string,
    routineType: 'procedure' | 'function'
  ) => void
  onExportDump?: (databaseName: string, tableName?: string) => void
  onExportDdl?: (databaseName: string, tableName?: string) => void
  onCopyToHost?: (databaseName: string, objectSelection?: CopyObjectSelection) => void
}

type ParsedNodeId = ReturnType<typeof parseNodeId>

interface MenuNodeInfo {
  node: TreeNode | undefined
  nodeType: NodeType
  databaseName: string
  nodeLabel: string
  categoryType: string | undefined
}

function categoryTypeOf(node: TreeNode | undefined, parsed: ParsedNodeId): string | undefined {
  const metadataCategoryType = node?.metadata?.categoryType
  const hasMetadataCategoryType =
    node?.type === 'category' && typeof metadataCategoryType === 'string'
  if (hasMetadataCategoryType) {
    return metadataCategoryType
  }
  if (parsed.type === 'category') return parsed.name
  return undefined
}

function resolveMenuNodeInfo(nodes: Record<string, TreeNode> | null, nodeId: string): MenuNodeInfo {
  const node = nodes?.[nodeId]
  const parsed = parseNodeId(nodeId)
  const objectName = node?.objectName ?? parsed.name
  return {
    node: node,
    nodeType: parsed.type,
    databaseName: node?.databaseName ?? parsed.database,
    nodeLabel: node?.label ?? objectName,
    categoryType: categoryTypeOf(node, parsed),
  }
}

function refreshesDatabase(nodeType: NodeType, node: TreeNode | undefined): boolean {
  const isTableLike = nodeType === 'table' || nodeType === 'view'
  if (!isTableLike) return true
  return Boolean(node?.parentId)
}

type NodeActions = Pick<
  BuildMenuArgs,
  'openSchemaInfoTab' | 'openViewDataTab' | 'copyName' | 'refreshNode'
>

interface NodeActionInput {
  info: MenuNodeInfo
  connectionId: string
  closeMenu: () => void
}

interface MenuPlacement {
  visible: boolean
  x: number
  y: number
}

function useNodeActions({ info, connectionId, closeMenu }: NodeActionInput): NodeActions {
  const openTab = useWorkspaceStore((state) => state.openTab)
  const refreshDatabase = useSchemaStore((state) => state.refreshDatabase)
  const { node, nodeType, databaseName, nodeLabel } = info
  const openObjectTab = (type: 'schema-info' | 'table-data', objectType: ObjectType) => {
    openTab({
      type: type,
      label: nodeLabel,
      connectionId: connectionId,
      databaseName: databaseName,
      objectName: nodeLabel,
      objectType: objectType,
    })
    closeMenu()
  }
  return {
    openSchemaInfoTab: () => openObjectTab('schema-info', nodeType as ObjectType),
    openViewDataTab: () => openObjectTab('table-data', 'view'),
    copyName: () => {
      void writeClipboardText(nodeLabel).catch((error: unknown) => {
        logFrontend(
          'warn',
          `[object-browser-context-menu] Copying the name failed: ${String(error)}`
        )
      })
      closeMenu()
    },
    refreshNode: () => {
      if (refreshesDatabase(nodeType, node)) {
        void refreshDatabase(connectionId, databaseName)
      }
      closeMenu()
    },
  }
}

function useDismissAllContextMenus(visible: boolean, closeMenu: () => void): void {
  useEffect(() => {
    if (!visible) return
    const onDismissAll = () => {
      closeMenu()
    }
    document.addEventListener(DISMISS_ALL_CONTEXT_MENUS, onDismissAll)
    return () => {
      document.removeEventListener(DISMISS_ALL_CONTEXT_MENUS, onDismissAll)
    }
  }, [visible, closeMenu])
}

function useViewportClampedMenu(
  menuRef: RefObject<HTMLDivElement | null>,
  placement: MenuPlacement
): void {
  const { visible, x, y } = placement
  useLayoutEffect(() => {
    const element = menuRef.current
    if (!visible) return
    if (!element) return
    const rect = element.getBoundingClientRect()
    const position = clampContextMenuPosition({
      requestedX: x,
      requestedY: y,
      menuWidth: rect.width,
      menuHeight: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    })
    element.style.left = `${position.x}px`
    element.style.top = `${position.y}px`
  }, [menuRef, visible, x, y])
}

function MenuEntryView({ entry }: { entry: MenuEntry }) {
  if (isSeparator(entry)) {
    return <hr className={CONTEXT_MENU_SEPARATOR} />
  }
  return (
    <Button
      variant="bare"
      className={contextMenuItemClassName(entry.destructive)}
      data-destructive={dataFlag(entry.destructive)}
      role="menuitem"
      disabled={entry.disabled}
      data-testid={`ctx-${entry.key}`}
      title={entry.title}
      onClick={entry.action}
    >
      <span className={CONTEXT_MENU_ICON}>{entry.icon}</span>
      <span>{entry.label}</span>
    </Button>
  )
}

interface ContextMenuEntriesProps extends ObjectBrowserContextMenuProps {
  nodeId: string
  closeMenu: () => void
}

function useContextMenuEntries(props: ContextMenuEntriesProps): MenuEntry[] {
  const { connectionId, nodeId, closeMenu } = props
  const nodes = useSchemaStore(
    (state) =>
      (state.connectionStates[connectionId] as ConnectionTreeState | undefined)?.nodes ?? null
  )
  const info = resolveMenuNodeInfo(nodes, nodeId)
  const nodeActions = useNodeActions({ info, connectionId, closeMenu })
  const entries = buildMenuEntries({
    ...props,
    ...nodeActions,
    nodeType: info.nodeType,
    databaseName: info.databaseName,
    objectName: info.nodeLabel,
    categoryType: info.categoryType,
  })
  return cleanSeparators(entries)
}

interface ContextMenuPanelProps extends ContextMenuEntriesProps {
  menuRef: RefObject<HTMLDivElement | null>
}

function ContextMenuPanel({ menuRef, ...entryProps }: ContextMenuPanelProps) {
  const cleanedEntries = useContextMenuEntries(entryProps)
  if (cleanedEntries.length === 0) return null
  return createPortal(
    <div
      ref={menuRef}
      className={CONTEXT_MENU}
      style={{ left: entryProps.x, top: entryProps.y }}
      role="menu"
      data-testid="object-browser-context-menu"
      onMouseDown={(event) => {
        event.preventDefault()
      }}
    >
      {cleanedEntries.map((entry) => (
        <MenuEntryView key={entry.key} entry={entry} />
      ))}
    </div>,
    document.body
  )
}

export function ObjectBrowserContextMenu(props: ObjectBrowserContextMenuProps) {
  const { visible, x, y, nodeId, onClose } = props
  const menuRef = useRef<HTMLDivElement>(null)
  const closeMenu = useCallback(() => {
    onClose()
  }, [onClose])

  useDismissOnOutsideClick({
    ref: menuRef,
    active: visible,
    onDismiss: closeMenu,
    options: { closeOnEscape: true },
  })
  useDismissAllContextMenus(visible, closeMenu)
  useViewportClampedMenu(menuRef, { visible, x, y })

  if (!visible) return null
  if (!nodeId) return null
  return <ContextMenuPanel {...props} nodeId={nodeId} closeMenu={closeMenu} menuRef={menuRef} />
}
