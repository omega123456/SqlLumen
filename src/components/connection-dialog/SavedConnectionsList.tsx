import { useCallback, useMemo, useState } from 'react'
import { ShieldCheck, X } from '@phosphor-icons/react'
import { IconButton } from '../common/IconButton'
import { InfoBar } from '../common/InfoBar'
import { useConnectionStore } from '../../stores/connection-store'
import { getContextMenuPortalRoot } from '../../lib/context-menu-utils'
import type { SavedConnection } from '../../types/connection'
import {
  buildConnectionSections,
  filterConnectionsByQuery,
} from './saved-connections/connection-sections'
import { useGroupEditing, type GroupEditing } from './saved-connections/use-group-editing'
import { SavedConnectionsToolbar } from './saved-connections/SavedConnectionsToolbar'
import { ConnectionSectionList } from './saved-connections/ConnectionSectionList'
import {
  SavedConnectionsContextMenu,
  type ContextMenuState,
} from './saved-connections/SavedConnectionsContextMenu'
import styles from './SavedConnectionsList.module.css'

const FOOTER_ICON_SIZE = 16

interface SavedConnectionsListProps {
  onSelectConnection: (connection: SavedConnection) => void
  onNewConnection: () => void
  onDuplicateConnection: (connection: SavedConnection) => void
  selectedConnectionId: string | null
}

function useFilteredSections(filterText: string) {
  const savedConnections = useConnectionStore((state) => state.savedConnections)
  const connectionGroups = useConnectionStore((state) => state.connectionGroups)
  const filteredConnections = useMemo(
    () => filterConnectionsByQuery(savedConnections, filterText),
    [savedConnections, filterText]
  )
  const sections = useMemo(
    () => buildConnectionSections(filteredConnections, connectionGroups),
    [filteredConnections, connectionGroups]
  )
  return { sections: sections, hasMatches: filteredConnections.length > 0 }
}

function contextMenuAnchor(event: React.MouseEvent) {
  event.preventDefault()
  return {
    x: event.clientX,
    y: event.clientY,
    portalRoot: getContextMenuPortalRoot(event.currentTarget),
  }
}

function ErrorBanner({ groups }: { groups: GroupEditing }) {
  if (!groups.error) return null
  return (
    <InfoBar
      severity="error"
      className={styles.errorBanner}
      message={groups.error}
      actions={
        <IconButton size="sm" onClick={groups.dismissError} aria-label="Dismiss error">
          <X size={FOOTER_ICON_SIZE} weight="regular" />
        </IconButton>
      }
    />
  )
}

function useContextMenuActions(
  groups: GroupEditing,
  onDuplicateConnection: (connection: SavedConnection) => void
) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const duplicateConnection = useCallback(
    (connection: SavedConnection) => {
      setContextMenu(null)
      onDuplicateConnection(connection)
    },
    [onDuplicateConnection]
  )

  return {
    contextMenu: contextMenu,
    closeContextMenu: closeContextMenu,
    openGroupMenu: (event: React.MouseEvent, groupId: string) =>
      setContextMenu({ ...contextMenuAnchor(event), type: 'group', groupId: groupId }),
    openConnectionMenu: (event: React.MouseEvent, connection: SavedConnection) =>
      setContextMenu({ ...contextMenuAnchor(event), type: 'connection', connection: connection }),
    actions: {
      onRenameGroup: (groupId: string) => {
        setContextMenu(null)
        groups.startRename(groupId)
      },
      onDeleteGroup: (groupId: string) => {
        setContextMenu(null)
        void groups.deleteGroup(groupId)
      },
      onDuplicateConnection: duplicateConnection,
    },
  }
}

export function SavedConnectionsList({
  onSelectConnection,
  onNewConnection,
  onDuplicateConnection,
  selectedConnectionId,
}: SavedConnectionsListProps) {
  const [filterText, setFilterText] = useState('')
  const { sections, hasMatches } = useFilteredSections(filterText)
  const groups = useGroupEditing()
  const menus = useContextMenuActions(groups, onDuplicateConnection)
  const trimmedFilter = filterText.trim()
  const showsNoMatches = trimmedFilter !== '' && !hasMatches

  return (
    <div className={styles.container}>
      <SavedConnectionsToolbar
        filterText={filterText}
        onFilterTextChange={setFilterText}
        onNewConnection={onNewConnection}
        onCreateGroup={groups.startCreate}
      />
      <ConnectionSectionList
        sections={sections}
        emptyFilterText={showsNoMatches ? trimmedFilter : null}
        context={{
          groups: groups,
          isFiltering: trimmedFilter.length > 0,
          selectedConnectionId: selectedConnectionId,
          itemHandlers: {
            onSelect: onSelectConnection,
            onContextMenu: menus.openConnectionMenu,
            onDuplicate: menus.actions.onDuplicateConnection,
          },
          onGroupContextMenu: menus.openGroupMenu,
        }}
      />
      <div className={styles.storageFooter}>
        <ShieldCheck
          size={FOOTER_ICON_SIZE}
          weight="regular"
          className={styles.storageIcon}
          aria-hidden
        />
        <span>Encrypted storage active</span>
      </div>
      <ErrorBanner groups={groups} />
      {menus.contextMenu && (
        <SavedConnectionsContextMenu
          menu={menus.contextMenu}
          actions={menus.actions}
          onClose={menus.closeContextMenu}
        />
      )}
    </div>
  )
}
