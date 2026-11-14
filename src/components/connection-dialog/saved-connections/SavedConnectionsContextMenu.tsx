import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { Copy, PencilSimple, Trash } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { useDismissOnOutsideClick } from '../useDismissOnOutsideClick'
import { getContextMenuPositionMode } from '../../../lib/context-menu-utils'
import { useContextMenuPlacement } from '../../../hooks/use-context-menu-placement'
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
  onDuplicateConnection: (connection: SavedConnection) => void
}

function GroupMenuItems({ groupId, actions }: { groupId: string; actions: ContextMenuActions }) {
  return (
    <>
      <Button
        variant="bare"
        className="ui-context-menu__item"
        role="menuitem"
        onClick={() => actions.onRenameGroup(groupId)}
      >
        <PencilSimple
          className="ui-context-menu__icon"
          size={MENU_ICON_SIZE}
          weight="regular"
          aria-hidden
        />
        <span>Rename</span>
      </Button>
      <div className="ui-context-menu__separator" role="separator" aria-orientation="horizontal" />
      <Button
        variant="bare"
        className="ui-context-menu__item ui-context-menu__item--destructive"
        role="menuitem"
        onClick={() => actions.onDeleteGroup(groupId)}
      >
        <Trash
          className="ui-context-menu__icon"
          size={MENU_ICON_SIZE}
          weight="regular"
          aria-hidden
        />
        <span>Delete</span>
      </Button>
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
    <Button
      variant="bare"
      className="ui-context-menu__item"
      role="menuitem"
      onClick={() => actions.onDuplicateConnection(connection)}
    >
      <Copy className="ui-context-menu__icon" size={MENU_ICON_SIZE} weight="regular" aria-hidden />
      <span>Duplicate</span>
    </Button>
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
      className="ui-context-menu"
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
