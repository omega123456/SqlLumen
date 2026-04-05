import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowsClockwise,
  CopySimple,
  Database,
  Info,
  ListNumbers,
  PencilSimple,
  Play,
  PlusCircle,
  Table,
  Trash,
  Eraser,
  Wrench,
} from '@phosphor-icons/react'
import { useDismissOnOutsideClick } from '../connection-dialog/useDismissOnOutsideClick'
import { clampContextMenuPosition, writeClipboardText } from '../../lib/context-menu-utils'
import { DISMISS_ALL_CONTEXT_MENUS } from '../../lib/context-menu-events'
import { parseNodeId, useSchemaStore, type ConnectionTreeState } from '../../stores/schema-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type { NodeType, ObjectType, EditableObjectType } from '../../types/schema'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ObjectBrowserContextMenuProps {
  visible: boolean
  x: number
  y: number
  nodeId: string | null
  connectionId: string
  isReadOnly: boolean
  onClose: () => void
  // Callbacks for mutating actions (wired in Phase 3.6)
  onCreateDatabase?: () => void
  onAlterDatabase?: (databaseName: string) => void
  onRenameDatabase?: (databaseName: string) => void
  onDropDatabase?: (databaseName: string) => void
  onDropTable?: (databaseName: string, tableName: string) => void
  onTruncateTable?: (databaseName: string, tableName: string) => void
  onRenameTable?: (databaseName: string, tableName: string) => void
  onDesignTable?: (databaseName: string, tableName: string) => void
  onCreateTable?: (databaseName: string) => void
  // Object editor callbacks (Phase 8.4)
  onAlterObject?: (databaseName: string, objectName: string, objectType: EditableObjectType) => void
  onDropObject?: (databaseName: string, objectName: string, objectType: EditableObjectType) => void
  onCreateObject?: (databaseName: string, objectType: EditableObjectType) => void
  // Execute routine callback (Phase 8.5)
  onExecuteRoutine?: (
    databaseName: string,
    routineName: string,
    routineType: 'procedure' | 'function'
  ) => void
}

// ---------------------------------------------------------------------------
// Menu item definitions
// ---------------------------------------------------------------------------

interface MenuItem {
  key: string
  label: string
  icon: React.ReactNode
  disabled: boolean
  destructive: boolean
  title?: string
  action: () => void
}

interface Separator {
  key: string
  separator: true
}

type MenuEntry = MenuItem | Separator

function isSeparator(entry: MenuEntry): entry is Separator {
  return 'separator' in entry && entry.separator
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ObjectBrowserContextMenu({
  visible,
  x,
  y,
  nodeId,
  connectionId,
  isReadOnly,
  onClose,
  onCreateDatabase,
  onAlterDatabase,
  onRenameDatabase,
  onDropDatabase,
  onDropTable,
  onTruncateTable,
  onRenameTable,
  onDesignTable,
  onCreateTable,
  onAlterObject,
  onDropObject,
  onCreateObject,
  onExecuteRoutine,
}: ObjectBrowserContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const openTab = useWorkspaceStore((state) => state.openTab)
  const refreshDatabase = useSchemaStore((state) => state.refreshDatabase)
  const nodes = useSchemaStore(
    (state) =>
      (state.connectionStates[connectionId] as ConnectionTreeState | undefined)?.nodes ?? null
  )

  const closeMenu = useCallback(() => {
    onClose()
  }, [onClose])

  useDismissOnOutsideClick(menuRef, visible, closeMenu, { closeOnEscape: true })

  // Listen for dismiss-all events from other context menus
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

  // Position the menu within the viewport after render
  useLayoutEffect(() => {
    if (!visible || !menuRef.current) return
    const el = menuRef.current
    const rect = el.getBoundingClientRect()
    const pos = clampContextMenuPosition(
      x,
      y,
      rect.width,
      rect.height,
      window.innerWidth,
      window.innerHeight
    )
    el.style.left = `${pos.x}px`
    el.style.top = `${pos.y}px`
  }, [visible, x, y])

  if (!visible || !nodeId) return null

  // Use direct fields on node if available, fall back to parseNodeId (Simplification 5)
  const node = nodes?.[nodeId]
  const parsed = parseNodeId(nodeId)
  const nodeType: NodeType = parsed.type
  const databaseName = node?.databaseName ?? parsed.database
  const objectName = node?.objectName ?? parsed.name
  const nodeLabel = node?.label ?? objectName
  const categoryType =
    node?.type === 'category' && typeof node.metadata?.categoryType === 'string'
      ? node.metadata.categoryType
      : nodeType === 'category'
        ? parsed.name
        : undefined

  // ---------------------------------------------------------------------------
  // Action helpers
  // ---------------------------------------------------------------------------

  const openSchemaInfoTab = () => {
    // Determine the objectType from the nodeType
    const objectType = nodeType as ObjectType
    openTab({
      type: 'schema-info',
      label: nodeLabel,
      connectionId,
      databaseName,
      objectName: nodeLabel,
      objectType,
    })
    closeMenu()
  }

  const copyName = () => {
    void writeClipboardText(nodeLabel).catch(() => {
      // Clipboard write failed — non-critical
    })
    closeMenu()
  }

  const refreshNode = () => {
    if (nodeType === 'database') {
      void refreshDatabase(connectionId, databaseName)
    } else if (nodeType === 'category') {
      // Refresh the parent database (resets all categories)
      void refreshDatabase(connectionId, databaseName)
    } else if (nodeType === 'table' || nodeType === 'view') {
      // Refresh the parent category — find it and reload
      if (node?.parentId) {
        // Reset the parent category's loaded state and reload
        void refreshDatabase(connectionId, databaseName)
      }
    } else {
      // For other types, refresh the entire database
      void refreshDatabase(connectionId, databaseName)
    }
    closeMenu()
  }

  // ---------------------------------------------------------------------------
  // Build menu items based on node type
  // ---------------------------------------------------------------------------

  const entries: MenuEntry[] = buildMenuEntries({
    nodeType,
    databaseName,
    objectName: nodeLabel,
    categoryType,
    isReadOnly,
    openSchemaInfoTab,
    copyName,
    refreshNode,
    onCreateDatabase,
    onAlterDatabase,
    onRenameDatabase,
    onDropDatabase,
    onDropTable,
    onTruncateTable,
    onRenameTable,
    onDesignTable,
    onCreateTable,
    onAlterObject,
    onDropObject,
    onCreateObject,
    onExecuteRoutine,
    closeMenu,
  })

  // Remove leading/trailing separators and consecutive separators
  const cleanedEntries = cleanSeparators(entries)

  if (cleanedEntries.length === 0) return null

  return createPortal(
    <div
      ref={menuRef}
      className="ui-context-menu"
      style={{ left: x, top: y }}
      role="menu"
      data-testid="object-browser-context-menu"
      onMouseDown={(e) => {
        e.preventDefault()
      }}
    >
      {cleanedEntries.map((entry) => {
        if (isSeparator(entry)) {
          return <hr key={entry.key} className="ui-context-menu__separator" />
        }

        const itemClass = [
          'ui-context-menu__item',
          entry.destructive ? 'ui-context-menu__item--destructive' : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <button
            key={entry.key}
            type="button"
            className={itemClass}
            role="menuitem"
            disabled={entry.disabled}
            data-testid={`ctx-${entry.key}`}
            title={entry.title}
            onClick={entry.action}
          >
            <span className="ui-context-menu__icon">{entry.icon}</span>
            <span>{entry.label}</span>
          </button>
        )
      })}
    </div>,
    document.body
  )
}

// ---------------------------------------------------------------------------
// Menu building
// ---------------------------------------------------------------------------

interface BuildMenuArgs {
  nodeType: NodeType
  databaseName: string
  objectName: string
  categoryType?: string
  isReadOnly: boolean
  openSchemaInfoTab: () => void
  copyName: () => void
  refreshNode: () => void
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
  closeMenu: () => void
}

function buildMenuEntries(args: BuildMenuArgs): MenuEntry[] {
  const {
    nodeType,
    databaseName,
    objectName,
    categoryType,
    isReadOnly,
    openSchemaInfoTab,
    copyName,
    refreshNode,
    onCreateDatabase,
    onAlterDatabase,
    onRenameDatabase,
    onDropDatabase,
    onDropTable,
    onTruncateTable,
    onRenameTable,
    onDesignTable,
    onCreateTable,
    onAlterObject,
    onDropObject,
    onCreateObject,
    onExecuteRoutine,
    closeMenu,
  } = args

  switch (nodeType) {
    case 'database':
      return buildDatabaseMenu({
        databaseName,
        isReadOnly,
        refreshNode,
        onCreateDatabase,
        onCreateTable,
        onAlterDatabase,
        onRenameDatabase,
        onDropDatabase,
        onCreateObject,
        closeMenu,
      })
    case 'table':
      return buildTableMenu({
        databaseName,
        objectName,
        isReadOnly,
        openSchemaInfoTab,
        copyName,
        refreshNode,
        onDropTable,
        onTruncateTable,
        onRenameTable,
        onDesignTable,
        onCreateTable,
        closeMenu,
      })
    case 'view':
      return buildViewMenu({
        databaseName,
        objectName,
        isReadOnly,
        openSchemaInfoTab,
        copyName,
        refreshNode,
        onAlterObject,
        onDropObject,
        closeMenu,
      })
    case 'procedure':
    case 'function':
      return buildRoutineMenu({
        databaseName,
        objectName,
        nodeType,
        isReadOnly,
        openSchemaInfoTab,
        copyName,
        refreshNode,
        onAlterObject,
        onDropObject,
        onExecuteRoutine,
        closeMenu,
      })
    case 'trigger':
    case 'event':
      return buildTriggerEventMenu({
        databaseName,
        objectName,
        nodeType,
        isReadOnly,
        openSchemaInfoTab,
        copyName,
        refreshNode,
        onAlterObject,
        onDropObject,
        closeMenu,
      })
    case 'category':
      return buildCategoryMenu({
        categoryType,
        databaseName,
        isReadOnly,
        refreshNode,
        onCreateTable,
        onCreateObject,
        closeMenu,
      })
    case 'column':
      return [
        {
          key: 'copy-name',
          label: 'Copy Column Name',
          icon: <CopySimple size={18} weight="regular" />,
          disabled: false,
          destructive: false,
          action: copyName,
        },
      ]
    default:
      return []
  }
}

function buildDatabaseMenu(args: {
  databaseName: string
  isReadOnly: boolean
  refreshNode: () => void
  onCreateDatabase?: () => void
  onAlterDatabase?: (databaseName: string) => void
  onRenameDatabase?: (databaseName: string) => void
  onDropDatabase?: (databaseName: string) => void
  onCreateTable?: (databaseName: string) => void
  onCreateObject?: (databaseName: string, objectType: EditableObjectType) => void
  closeMenu: () => void
}): MenuEntry[] {
  const {
    databaseName,
    isReadOnly,
    refreshNode,
    onCreateDatabase,
    onAlterDatabase,
    onRenameDatabase,
    onDropDatabase,
    onCreateTable,
    onCreateObject,
    closeMenu,
  } = args

  if (isReadOnly) {
    return [
      {
        key: 'refresh',
        label: 'Refresh',
        icon: <ArrowsClockwise size={18} weight="regular" />,
        disabled: false,
        destructive: false,
        action: refreshNode,
      },
    ]
  }

  return [
    {
      key: 'create-database',
      label: 'Create Database...',
      icon: <PlusCircle size={18} weight="regular" />,
      disabled: !onCreateDatabase,
      destructive: false,
      action: () => {
        onCreateDatabase?.()
        closeMenu()
      },
    },
    {
      key: 'create-table',
      label: 'Create Table...',
      icon: <Table size={18} weight="regular" />,
      disabled: !onCreateTable,
      destructive: false,
      action: () => {
        onCreateTable?.(databaseName)
        closeMenu()
      },
    },
    {
      key: 'create-view',
      label: 'Create View...',
      icon: <PlusCircle size={18} weight="regular" />,
      disabled: !onCreateObject,
      destructive: false,
      action: () => {
        onCreateObject?.(databaseName, 'view')
        closeMenu()
      },
    },
    {
      key: 'create-procedure',
      label: 'Create Procedure...',
      icon: <PlusCircle size={18} weight="regular" />,
      disabled: !onCreateObject,
      destructive: false,
      action: () => {
        onCreateObject?.(databaseName, 'procedure')
        closeMenu()
      },
    },
    {
      key: 'create-function',
      label: 'Create Function...',
      icon: <PlusCircle size={18} weight="regular" />,
      disabled: !onCreateObject,
      destructive: false,
      action: () => {
        onCreateObject?.(databaseName, 'function')
        closeMenu()
      },
    },
    {
      key: 'create-trigger',
      label: 'Create Trigger...',
      icon: <PlusCircle size={18} weight="regular" />,
      disabled: !onCreateObject,
      destructive: false,
      action: () => {
        onCreateObject?.(databaseName, 'trigger')
        closeMenu()
      },
    },
    {
      key: 'create-event',
      label: 'Create Event...',
      icon: <PlusCircle size={18} weight="regular" />,
      disabled: !onCreateObject,
      destructive: false,
      action: () => {
        onCreateObject?.(databaseName, 'event')
        closeMenu()
      },
    },
    {
      key: 'alter-database',
      label: 'Alter Database...',
      icon: <Database size={18} weight="regular" />,
      disabled: !onAlterDatabase,
      destructive: false,
      action: () => {
        onAlterDatabase?.(databaseName)
        closeMenu()
      },
    },
    {
      key: 'rename-database',
      label: 'Rename Database...',
      icon: <PencilSimple size={18} weight="regular" />,
      disabled: !onRenameDatabase,
      destructive: false,
      action: () => {
        onRenameDatabase?.(databaseName)
        closeMenu()
      },
    },
    { key: 'sep-1', separator: true },
    {
      key: 'drop-database',
      label: 'Drop Database...',
      icon: <Trash size={18} weight="regular" />,
      disabled: !onDropDatabase,
      destructive: true,
      action: () => {
        onDropDatabase?.(databaseName)
        closeMenu()
      },
    },
    { key: 'sep-2', separator: true },
    {
      key: 'refresh',
      label: 'Refresh',
      icon: <ArrowsClockwise size={18} weight="regular" />,
      disabled: false,
      destructive: false,
      action: refreshNode,
    },
  ]
}

function buildTableMenu(args: {
  databaseName: string
  objectName: string
  isReadOnly: boolean
  openSchemaInfoTab: () => void
  copyName: () => void
  refreshNode: () => void
  onDropTable?: (databaseName: string, tableName: string) => void
  onTruncateTable?: (databaseName: string, tableName: string) => void
  onRenameTable?: (databaseName: string, tableName: string) => void
  onDesignTable?: (databaseName: string, tableName: string) => void
  onCreateTable?: (databaseName: string) => void
  closeMenu: () => void
}): MenuEntry[] {
  const {
    databaseName,
    objectName,
    isReadOnly,
    openSchemaInfoTab,
    copyName,
    refreshNode,
    onDropTable,
    onTruncateTable,
    onRenameTable,
    onDesignTable,
    onCreateTable,
    closeMenu,
  } = args

  if (isReadOnly) {
    return [
      {
        key: 'schema-info',
        label: 'Schema Info',
        icon: <Info size={18} weight="regular" />,
        disabled: false,
        destructive: false,
        action: openSchemaInfoTab,
      },
      {
        key: 'copy-name',
        label: 'Copy Table Name',
        icon: <CopySimple size={18} weight="regular" />,
        disabled: false,
        destructive: false,
        action: copyName,
      },
      {
        key: 'refresh',
        label: 'Refresh',
        icon: <ArrowsClockwise size={18} weight="regular" />,
        disabled: false,
        destructive: false,
        action: refreshNode,
      },
    ]
  }

  return [
    {
      key: 'create-table',
      label: 'Create Table...',
      icon: <Table size={18} weight="regular" />,
      disabled: !onCreateTable,
      destructive: false,
      action: () => {
        onCreateTable?.(databaseName)
        closeMenu()
      },
    },
    {
      key: 'select-rows',
      label: 'Select Top 100 Rows',
      icon: <ListNumbers size={18} weight="regular" />,
      disabled: true, // Phase 4
      destructive: false,
      action: () => {
        /* Phase 4 */
      },
    },
    {
      key: 'design-table',
      label: 'Design Table...',
      icon: <Wrench size={18} weight="regular" />,
      disabled: !onDesignTable,
      destructive: false,
      action: () => {
        onDesignTable?.(databaseName, objectName)
        closeMenu()
      },
    },
    {
      key: 'schema-info',
      label: 'Schema Info',
      icon: <Info size={18} weight="regular" />,
      disabled: false,
      destructive: false,
      action: openSchemaInfoTab,
    },
    { key: 'sep-1', separator: true },
    {
      key: 'truncate-table',
      label: 'Truncate Table...',
      icon: <Eraser size={18} weight="regular" />,
      disabled: !onTruncateTable,
      destructive: true,
      action: () => {
        onTruncateTable?.(databaseName, objectName)
        closeMenu()
      },
    },
    {
      key: 'drop-table',
      label: 'Drop Table...',
      icon: <Trash size={18} weight="regular" />,
      disabled: !onDropTable,
      destructive: true,
      action: () => {
        onDropTable?.(databaseName, objectName)
        closeMenu()
      },
    },
    { key: 'sep-2', separator: true },
    {
      key: 'rename-table',
      label: 'Rename Table...',
      icon: <PencilSimple size={18} weight="regular" />,
      disabled: !onRenameTable,
      destructive: false,
      action: () => {
        onRenameTable?.(databaseName, objectName)
        closeMenu()
      },
    },
    {
      key: 'copy-name',
      label: 'Copy Table Name',
      icon: <CopySimple size={18} weight="regular" />,
      disabled: false,
      destructive: false,
      action: copyName,
    },
    {
      key: 'refresh',
      label: 'Refresh',
      icon: <ArrowsClockwise size={18} weight="regular" />,
      disabled: false,
      destructive: false,
      action: refreshNode,
    },
  ]
}

function buildCategoryMenu(args: {
  categoryType?: string
  databaseName: string
  isReadOnly: boolean
  refreshNode: () => void
  onCreateTable?: (databaseName: string) => void
  onCreateObject?: (databaseName: string, objectType: EditableObjectType) => void
  closeMenu: () => void
}): MenuEntry[] {
  const {
    categoryType,
    databaseName,
    isReadOnly,
    refreshNode,
    onCreateTable,
    onCreateObject,
    closeMenu,
  } = args

  const entries: MenuEntry[] = []

  if (categoryType === 'table' && !isReadOnly) {
    entries.push({
      key: 'create-table',
      label: 'Create Table...',
      icon: <Table size={18} weight="regular" />,
      disabled: !onCreateTable,
      destructive: false,
      action: () => {
        onCreateTable?.(databaseName)
        closeMenu()
      },
    })
  }

  // Create items for object-editor categories
  const objectCategoryMap: Record<string, EditableObjectType> = {
    view: 'view',
    procedure: 'procedure',
    function: 'function',
    trigger: 'trigger',
    event: 'event',
  }
  const objectType = categoryType ? objectCategoryMap[categoryType] : undefined
  if (objectType && !isReadOnly) {
    const typeLabel = categoryType!.charAt(0).toUpperCase() + categoryType!.slice(1)
    entries.push({
      key: `create-${objectType}`,
      label: `Create ${typeLabel}...`,
      icon: <PlusCircle size={18} weight="regular" />,
      disabled: !onCreateObject,
      destructive: false,
      action: () => {
        onCreateObject?.(databaseName, objectType)
        closeMenu()
      },
    })
  }

  if (entries.length > 0) {
    entries.push({ key: 'sep-1', separator: true })
  }

  entries.push({
    key: 'refresh',
    label: 'Refresh',
    icon: <ArrowsClockwise size={18} weight="regular" />,
    disabled: false,
    destructive: false,
    action: refreshNode,
  })

  return entries
}

function buildViewMenu(args: {
  databaseName: string
  objectName: string
  isReadOnly: boolean
  openSchemaInfoTab: () => void
  copyName: () => void
  refreshNode: () => void
  onAlterObject?: (databaseName: string, objectName: string, objectType: EditableObjectType) => void
  onDropObject?: (databaseName: string, objectName: string, objectType: EditableObjectType) => void
  closeMenu: () => void
}): MenuEntry[] {
  const {
    databaseName,
    objectName,
    isReadOnly,
    openSchemaInfoTab,
    copyName,
    refreshNode,
    onAlterObject,
    onDropObject,
    closeMenu,
  } = args

  if (isReadOnly) {
    return [
      {
        key: 'schema-info',
        label: 'Schema Info',
        icon: <Info size={18} weight="regular" />,
        disabled: false,
        destructive: false,
        action: openSchemaInfoTab,
      },
      {
        key: 'copy-name',
        label: 'Copy Name',
        icon: <CopySimple size={18} weight="regular" />,
        disabled: false,
        destructive: false,
        action: copyName,
      },
      {
        key: 'refresh',
        label: 'Refresh',
        icon: <ArrowsClockwise size={18} weight="regular" />,
        disabled: false,
        destructive: false,
        action: refreshNode,
      },
    ]
  }

  return [
    {
      key: 'schema-info',
      label: 'Schema Info',
      icon: <Info size={18} weight="regular" />,
      disabled: false,
      destructive: false,
      action: openSchemaInfoTab,
    },
    {
      key: 'alter-view',
      label: 'Alter View...',
      icon: <PencilSimple size={18} weight="regular" />,
      disabled: !onAlterObject,
      destructive: false,
      action: () => {
        onAlterObject?.(databaseName, objectName, 'view')
        closeMenu()
      },
    },
    { key: 'sep-1', separator: true },
    {
      key: 'drop-view',
      label: 'Drop View...',
      icon: <Trash size={18} weight="regular" />,
      disabled: !onDropObject,
      destructive: true,
      action: () => {
        onDropObject?.(databaseName, objectName, 'view')
        closeMenu()
      },
    },
    { key: 'sep-2', separator: true },
    {
      key: 'copy-name',
      label: 'Copy Name',
      icon: <CopySimple size={18} weight="regular" />,
      disabled: false,
      destructive: false,
      action: copyName,
    },
    {
      key: 'refresh',
      label: 'Refresh',
      icon: <ArrowsClockwise size={18} weight="regular" />,
      disabled: false,
      destructive: false,
      action: refreshNode,
    },
  ]
}

function buildRoutineMenu(args: {
  databaseName: string
  objectName: string
  nodeType: 'procedure' | 'function'
  isReadOnly: boolean
  openSchemaInfoTab: () => void
  copyName: () => void
  refreshNode: () => void
  onAlterObject?: (databaseName: string, objectName: string, objectType: EditableObjectType) => void
  onDropObject?: (databaseName: string, objectName: string, objectType: EditableObjectType) => void
  onExecuteRoutine?: (
    databaseName: string,
    routineName: string,
    routineType: 'procedure' | 'function'
  ) => void
  closeMenu: () => void
}): MenuEntry[] {
  const {
    databaseName,
    objectName,
    nodeType,
    isReadOnly,
    openSchemaInfoTab,
    copyName,
    refreshNode,
    onAlterObject,
    onDropObject,
    onExecuteRoutine,
    closeMenu,
  } = args
  const typeLabel = nodeType === 'procedure' ? 'Procedure' : 'Function'

  if (isReadOnly) {
    return [
      {
        key: 'schema-info',
        label: 'Schema Info',
        icon: <Info size={18} weight="regular" />,
        disabled: false,
        destructive: false,
        action: openSchemaInfoTab,
      },
      {
        key: 'copy-name',
        label: 'Copy Name',
        icon: <CopySimple size={18} weight="regular" />,
        disabled: false,
        destructive: false,
        action: copyName,
      },
      {
        key: 'refresh',
        label: 'Refresh',
        icon: <ArrowsClockwise size={18} weight="regular" />,
        disabled: false,
        destructive: false,
        action: refreshNode,
      },
    ]
  }

  return [
    {
      key: 'schema-info',
      label: 'Schema Info',
      icon: <Info size={18} weight="regular" />,
      disabled: false,
      destructive: false,
      action: openSchemaInfoTab,
    },
    {
      key: 'execute',
      label: 'Execute',
      icon: <Play size={18} weight="regular" />,
      disabled: !onExecuteRoutine,
      destructive: false,
      action: () => {
        onExecuteRoutine?.(databaseName, objectName, nodeType)
        closeMenu()
      },
    },
    {
      key: `alter-${nodeType}`,
      label: `Alter ${typeLabel}...`,
      icon: <PencilSimple size={18} weight="regular" />,
      disabled: !onAlterObject,
      destructive: false,
      action: () => {
        onAlterObject?.(databaseName, objectName, nodeType)
        closeMenu()
      },
    },
    { key: 'sep-1', separator: true },
    {
      key: `drop-${nodeType}`,
      label: `Drop ${typeLabel}...`,
      icon: <Trash size={18} weight="regular" />,
      disabled: !onDropObject,
      destructive: true,
      action: () => {
        onDropObject?.(databaseName, objectName, nodeType)
        closeMenu()
      },
    },
    { key: 'sep-2', separator: true },
    {
      key: 'copy-name',
      label: 'Copy Name',
      icon: <CopySimple size={18} weight="regular" />,
      disabled: false,
      destructive: false,
      action: copyName,
    },
    {
      key: 'refresh',
      label: 'Refresh',
      icon: <ArrowsClockwise size={18} weight="regular" />,
      disabled: false,
      destructive: false,
      action: refreshNode,
    },
  ]
}

function buildTriggerEventMenu(args: {
  databaseName: string
  objectName: string
  nodeType: 'trigger' | 'event'
  isReadOnly: boolean
  openSchemaInfoTab: () => void
  copyName: () => void
  refreshNode: () => void
  onAlterObject?: (databaseName: string, objectName: string, objectType: EditableObjectType) => void
  onDropObject?: (databaseName: string, objectName: string, objectType: EditableObjectType) => void
  closeMenu: () => void
}): MenuEntry[] {
  const {
    databaseName,
    objectName,
    nodeType,
    isReadOnly,
    openSchemaInfoTab,
    copyName,
    refreshNode,
    onAlterObject,
    onDropObject,
    closeMenu,
  } = args
  const typeLabel = nodeType === 'trigger' ? 'Trigger' : 'Event'

  if (isReadOnly) {
    return [
      {
        key: 'schema-info',
        label: 'Schema Info',
        icon: <Info size={18} weight="regular" />,
        disabled: false,
        destructive: false,
        action: openSchemaInfoTab,
      },
      {
        key: 'copy-name',
        label: 'Copy Name',
        icon: <CopySimple size={18} weight="regular" />,
        disabled: false,
        destructive: false,
        action: copyName,
      },
      {
        key: 'refresh',
        label: 'Refresh',
        icon: <ArrowsClockwise size={18} weight="regular" />,
        disabled: false,
        destructive: false,
        action: refreshNode,
      },
    ]
  }

  return [
    {
      key: 'schema-info',
      label: 'Schema Info',
      icon: <Info size={18} weight="regular" />,
      disabled: false,
      destructive: false,
      action: openSchemaInfoTab,
    },
    {
      key: `alter-${nodeType}`,
      label: `Alter ${typeLabel}...`,
      icon: <PencilSimple size={18} weight="regular" />,
      disabled: !onAlterObject,
      destructive: false,
      action: () => {
        onAlterObject?.(databaseName, objectName, nodeType)
        closeMenu()
      },
    },
    { key: 'sep-1', separator: true },
    {
      key: `drop-${nodeType}`,
      label: `Drop ${typeLabel}...`,
      icon: <Trash size={18} weight="regular" />,
      disabled: !onDropObject,
      destructive: true,
      action: () => {
        onDropObject?.(databaseName, objectName, nodeType)
        closeMenu()
      },
    },
    { key: 'sep-2', separator: true },
    {
      key: 'copy-name',
      label: 'Copy Name',
      icon: <CopySimple size={18} weight="regular" />,
      disabled: false,
      destructive: false,
      action: copyName,
    },
    {
      key: 'refresh',
      label: 'Refresh',
      icon: <ArrowsClockwise size={18} weight="regular" />,
      disabled: false,
      destructive: false,
      action: refreshNode,
    },
  ]
}

/** Remove leading/trailing separators and collapse consecutive separators. */
function cleanSeparators(entries: MenuEntry[]): MenuEntry[] {
  const result: MenuEntry[] = []
  for (const entry of entries) {
    if (isSeparator(entry)) {
      // Skip if result is empty or last entry was also a separator
      if (result.length === 0 || isSeparator(result[result.length - 1])) {
        continue
      }
    }
    result.push(entry)
  }
  // Remove trailing separator
  while (result.length > 0 && isSeparator(result[result.length - 1])) {
    result.pop()
  }
  return result
}
