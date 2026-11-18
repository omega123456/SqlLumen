import { useState, type MouseEvent } from 'react'
import type { SavedConnection } from '../../../types/connection'
import type { ContextMenuActions, ContextMenuState } from './SavedConnectionsContextMenu'
import type { GroupEditing } from './use-group-editing'
import type { TileActions } from './use-tile-actions'

interface BoardMenuSources {
  tileActions: TileActions
  groups: GroupEditing
}

function menuActions({ tileActions, groups }: BoardMenuSources, close: () => void) {
  const actions: ContextMenuActions = {
    onRenameGroup: (groupId) => {
      close()
      groups.startRename(groupId)
    },
    onDeleteGroup: (groupId) => {
      close()
      void groups.deleteGroup(groupId)
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

export function useBoardMenu(sources: BoardMenuSources) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const close = () => setMenu(null)

  const openForConnection = (event: MouseEvent<HTMLButtonElement>, connection: SavedConnection) => {
    const anchor = event.currentTarget.getBoundingClientRect()
    setMenu({
      type: 'connection',
      connection: connection,
      x: anchor.left,
      y: anchor.bottom,
      portalRoot: document.body,
    })
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
    openForGroup: openForGroup,
  }
}

export type BoardMenu = ReturnType<typeof useBoardMenu>
