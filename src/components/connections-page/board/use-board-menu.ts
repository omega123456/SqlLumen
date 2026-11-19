import { useState, type MouseEvent } from 'react'
import { useConnectionStore } from '../../../stores/connection-store'
import type { SavedConnection } from '../../../types/connection'
import type { ContextMenuActions, ContextMenuState } from './SavedConnectionsContextMenu'
import type { GroupEditing } from './use-group-editing'
import type { TileActions } from './use-tile-actions'

interface BoardMenuSources {
  tileActions: TileActions
  groups: GroupEditing
}

interface MenuPoint {
  x: number
  y: number
}

function menuActions({ tileActions, groups }: BoardMenuSources, close: () => void) {
  const actions: ContextMenuActions = {
    onEditGroup: (groupId) => {
      close()
      groups.openEditor(groupId)
    },
    onDeleteGroup: (groupId) => {
      close()
      groups.requestDelete(groupId)
    },
    onMoveToGroup: (move) => {
      close()
      void tileActions.moveToGroup(move)
    },
    onOpenNewSession: (connection) => {
      close()
      void tileActions.openNewSession(connection)
    },
    onEditConnection: (connection) => {
      close()
      tileActions.edit(connection.id)
    },
    onDuplicateConnection: (connection) => {
      close()
      tileActions.duplicate(connection)
    },
    onCopyConnectionUrl: (connection) => {
      close()
      void tileActions.copyUrl(connection)
    },
    onDeleteConnection: (connection) => {
      close()
      tileActions.requestDelete(connection)
    },
  }
  return actions
}

function belowLeftOf(element: Element): MenuPoint {
  const anchor = element.getBoundingClientRect()
  return { x: anchor.left, y: anchor.bottom }
}

function savedConnectionById(profileId: string | undefined): SavedConnection | null {
  const savedConnections = useConnectionStore.getState().savedConnections
  return savedConnections.find((connection) => connection.id === profileId) ?? null
}

export function useBoardMenu(sources: BoardMenuSources) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const close = () => setMenu(null)

  const openConnectionMenu = (connection: SavedConnection, point: MenuPoint) => {
    setMenu({
      type: 'connection',
      connection: connection,
      x: point.x,
      y: point.y,
      portalRoot: document.body,
    })
  }

  const openForConnection = (event: MouseEvent<HTMLButtonElement>, connection: SavedConnection) =>
    openConnectionMenu(connection, belowLeftOf(event.currentTarget))

  const openForTileContextMenu = (event: MouseEvent, connection: SavedConnection) => {
    event.preventDefault()
    event.stopPropagation()
    openConnectionMenu(connection, { x: event.clientX, y: event.clientY })
  }

  const openForTileKey = (tile: HTMLElement) => {
    const connection = savedConnectionById(tile.dataset.profileId)
    if (connection) openConnectionMenu(connection, belowLeftOf(tile))
  }

  const openForGroup = (event: MouseEvent, groupId: string) => {
    event.preventDefault()
    setMenu({
      type: 'group',
      groupId: groupId,
      x: event.clientX,
      y: event.clientY,
      portalRoot: document.body,
    })
  }

  return {
    menu: menu,
    actions: menuActions(sources, close),
    close: close,
    openForConnection: openForConnection,
    openForTileContextMenu: openForTileContextMenu,
    openForTileKey: openForTileKey,
    openForGroup: openForGroup,
  }
}

export type BoardMenu = ReturnType<typeof useBoardMenu>
