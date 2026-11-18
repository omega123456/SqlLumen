import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { Copy, LinkSimple, PencilSimple, StackPlus, Trash, type Icon } from '@phosphor-icons/react'
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
import type { SavedConnection } from '../../../types/connection'

const MENU_ICON_SIZE = 18

interface ContextMenuPosition {
  x: number
  y: number
  portalRoot: HTMLElement
}

export type ContextMenuState =
  | (ContextMenuPosition & { type: 'group'; groupId: string })
  | (ContextMenuPosition & { type: 'connection'; connection: SavedConnection })

export interface ContextMenuActions {
  onRenameGroup: (groupId: string) => void
  onDeleteGroup: (groupId: string) => void
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
        label="Rename"
        onSelect={() => actions.onRenameGroup(groupId)}
      />
      <MenuSeparator />
      <MenuItem
        icon={Trash}
        label="Delete"
        isDestructive
        onSelect={() => actions.onDeleteGroup(groupId)}
      />
    </>
  )
}

function ConnectionMenuItems({
  connection,
  actions,
}: {
  connection: SavedConnection
  actions: ContextMenuActions
}) {
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
