import { useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  Copy,
  LinkSimple,
  PencilSimple,
  StackPlus,
  Trash,
  type Icon,
} from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { useDismissOnOutsideClick } from '../../../hooks/use-dismiss-on-outside-click'
import {
  CONTEXT_MENU,
  CONTEXT_MENU_ICON,
  CONTEXT_MENU_SEPARATOR,
  contextMenuItemClassName,
} from '../../../lib/class-names-menu'
import { getContextMenuPositionMode } from '../../../lib/context-menu-utils'
import { useContextMenuPlacement } from '../../../hooks/use-context-menu-placement'
import { dataFlag } from '../../../lib/data-attributes'
import { useConnectionStore } from '../../../stores/connection-store'
import type { SavedConnection } from '../../../types/connection'
import { UNGROUPED_SECTION_TITLE } from './connection-sections'

const MENU_ICON_SIZE = 18
const MOVE_CHECK_SIZE = 14

interface ContextMenuPosition {
  x: number
  y: number
  portalRoot: HTMLElement
}

export type ContextMenuState =
  | (ContextMenuPosition & { type: 'group'; groupId: string })
  | (ContextMenuPosition & { type: 'connection'; connection: SavedConnection })

export interface GroupMove {
  connection: SavedConnection
  groupId: string | null
}

export interface ContextMenuActions {
  onEditGroup: (groupId: string) => void
  onDeleteGroup: (groupId: string) => void
  onMoveToGroup: (move: GroupMove) => void
  onOpenNewSession: (connection: SavedConnection) => void
  onEditConnection: (connection: SavedConnection) => void
  onDuplicateConnection: (connection: SavedConnection) => void
  onCopyConnectionUrl: (connection: SavedConnection) => void
  onDeleteConnection: (connection: SavedConnection) => void
}

interface MenuItemProps {
  icon: Icon
  label: string
  isDestructive?: boolean
  onSelect: () => void
}

function MenuItem({ icon: ItemIcon, label, isDestructive = false, onSelect }: MenuItemProps) {
  return (
    <Button
      variant="bare"
      className={contextMenuItemClassName(isDestructive)}
      data-destructive={dataFlag(isDestructive)}
      role="menuitem"
      onClick={onSelect}
    >
      <ItemIcon className={CONTEXT_MENU_ICON} size={MENU_ICON_SIZE} weight="regular" aria-hidden />
      <span>{label}</span>
    </Button>
  )
}

function MenuSeparator() {
  return <div className={CONTEXT_MENU_SEPARATOR} role="separator" aria-orientation="horizontal" />
}

function GroupMenuItems({ groupId, actions }: { groupId: string; actions: ContextMenuActions }) {
  return (
    <>
      <MenuItem
        icon={PencilSimple}
        label="Edit group…"
        onSelect={() => actions.onEditGroup(groupId)}
      />
      <MenuSeparator />
      <MenuItem
        icon={Trash}
        label="Delete group…"
        isDestructive
        onSelect={() => actions.onDeleteGroup(groupId)}
      />
    </>
  )
}

interface MoveTarget {
  groupId: string | null
  name: string
  color: string | null
}

const UNGROUPED_TARGET: MoveTarget = { groupId: null, name: UNGROUPED_SECTION_TITLE, color: null }

function useMoveTargets(): MoveTarget[] {
  const groups = useConnectionStore((state) => state.connectionGroups)
  if (groups.length === 0) return []
  const groupTargets = groups.map((group) => ({
    groupId: group.id,
    name: group.name,
    color: group.color,
  }))
  return [UNGROUPED_TARGET, ...groupTargets]
}

function MoveTargetDot({ color }: { color: string | null }) {
  if (color === null) {
    return (
      <span
        className="size-2.5 rounded-round border border-light-outline dark:border-dark-outline"
        aria-hidden
      />
    )
  }
  return <span className="size-2.5 rounded-round" style={{ backgroundColor: color }} aria-hidden />
}

interface MoveItemProps {
  target: MoveTarget
  isCurrent: boolean
  onSelect: () => void
}

function MoveItem({ target, isCurrent, onSelect }: MoveItemProps) {
  return (
    <Button
      variant="bare"
      className={contextMenuItemClassName(false)}
      role="menuitemradio"
      aria-checked={isCurrent}
      onClick={onSelect}
    >
      <span className="flex size-4.5 shrink-0 items-center justify-center">
        <MoveTargetDot color={target.color} />
      </span>
      <span className="min-w-0 flex-1 truncate">{target.name}</span>
      <span className="flex size-4 shrink-0 items-center justify-center text-light-primary dark:text-dark-primary">
        {isCurrent && <Check size={MOVE_CHECK_SIZE} weight="bold" aria-hidden />}
      </span>
    </Button>
  )
}

function MoveToGroupItems({ connection, actions }: ConnectionMenuItemsProps) {
  const targets = useMoveTargets()
  if (targets.length === 0) return null
  return (
    <>
      <MenuSeparator />
      <span className="px-2.5 pt-1 pb-0.5 text-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
        Move to group
      </span>
      {targets.map((target) => (
        <MoveItem
          key={target.groupId ?? UNGROUPED_SECTION_TITLE}
          target={target}
          isCurrent={target.groupId === connection.groupId}
          onSelect={() =>
            actions.onMoveToGroup({ connection: connection, groupId: target.groupId })
          }
        />
      ))}
    </>
  )
}

interface ConnectionMenuItemsProps {
  connection: SavedConnection
  actions: ContextMenuActions
}

function ConnectionMenuItems({ connection, actions }: ConnectionMenuItemsProps) {
  return (
    <>
      <MenuItem
        icon={StackPlus}
        label="Open in new session"
        onSelect={() => actions.onOpenNewSession(connection)}
      />
      <MenuSeparator />
      <MenuItem
        icon={PencilSimple}
        label="Edit"
        onSelect={() => actions.onEditConnection(connection)}
      />
      <MenuItem
        icon={Copy}
        label="Duplicate"
        onSelect={() => actions.onDuplicateConnection(connection)}
      />
      <MenuItem
        icon={LinkSimple}
        label="Copy URL"
        onSelect={() => actions.onCopyConnectionUrl(connection)}
      />
      <MoveToGroupItems connection={connection} actions={actions} />
      <MenuSeparator />
      <MenuItem
        icon={Trash}
        label="Delete"
        isDestructive
        onSelect={() => actions.onDeleteConnection(connection)}
      />
    </>
  )
}

interface SavedConnectionsContextMenuProps {
  menu: ContextMenuState
  actions: ContextMenuActions
  onClose: () => void
}

export function SavedConnectionsContextMenu({
  menu,
  actions,
  onClose,
}: SavedConnectionsContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  useDismissOnOutsideClick({
    ref: menuRef,
    active: true,
    onDismiss: onClose,
    options: { closeOnEscape: true },
  })
  useContextMenuPlacement(menuRef, menu)

  return createPortal(
    <div
      ref={menuRef}
      className={CONTEXT_MENU}
      data-testid="saved-connections-context-menu"
      style={{
        left: menu.x,
        top: menu.y,
        position: getContextMenuPositionMode(menu.portalRoot),
      }}
      role="menu"
    >
      {menu.type === 'group' && <GroupMenuItems groupId={menu.groupId} actions={actions} />}
      {menu.type === 'connection' && (
        <ConnectionMenuItems connection={menu.connection} actions={actions} />
      )}
    </div>,
    menu.portalRoot
  )
}
