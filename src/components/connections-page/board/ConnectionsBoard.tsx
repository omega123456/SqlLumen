import { useState, type ReactNode } from 'react'
import { FolderPlus, Plus } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { ConfirmDialog } from '../../dialogs/ConfirmDialog'
import { useConnectionStore, type SavedConnectionsLoad } from '../../../stores/connection-store'
import { useConnectionsPageStore } from '../../../stores/connections-page-store'
import { parseConnectionComposerText } from '../../../lib/mysql-connection-url'
import { BackToSession, PageFrame } from '../PageChrome'
import { PAGE_ICON_SIZE } from '../page-icons'
import { BoardEmpty, BoardLoadError, BoardNoMatch, BoardSkeleton } from './BoardStates'
import { ConnectionComposer } from './ConnectionComposer'
import { ConnectionSection, SectionHeading, type SectionTileContext } from './ConnectionSection'
import type { TileHandlers } from './ConnectionTile'
import { GroupInlineInput } from './GroupInlineInput'
import { SavedConnectionsContextMenu } from './SavedConnectionsContextMenu'
import {
  boardStateOf,
  buildBoardSections,
  savedServersLabel,
  tileKey,
  visibleConnectionCount,
  type BoardSection,
  type BoardState,
} from './board-model'
import { useBoardMenu, type BoardMenu } from './use-board-menu'
import { useGroupEditing, type GroupEditing } from './use-group-editing'
import { useTileActions, type TileActions } from './use-tile-actions'
import { resolveActiveTileKey, useTileRovingFocus } from './use-tile-roving-focus'
import { useUrlImport } from './use-url-import'

type BoardTiles = Omit<SectionTileContext, 'focusTargetKey' | 'handlers'> & {
  handlers: Omit<TileHandlers, 'onFocusTile'>
}

interface BoardBodyProps {
  sections: BoardSection[]
  query: string
  loadError: string
  tiles: BoardTiles
  groups: GroupEditing
  menu: BoardMenu
  onRetry: () => void
  onNewConnection: () => void
  onClearFilter: () => void
}

function allTileKeys(sections: BoardSection[]): string[] {
  return sections.flatMap((section) =>
    section.connections.map((connection) => tileKey(section, connection))
  )
}

function SectionsBody({ sections, tiles, groups, menu }: BoardBodyProps) {
  const { containerRef, activeKey, setActiveKey, handleKeyDown } = useTileRovingFocus({
    onEdit: tiles.handlers.onEdit,
    onOpenMenu: menu.openForTileKey,
  })
  const sectionTiles: SectionTileContext = {
    ...tiles,
    focusTargetKey: resolveActiveTileKey(activeKey, allTileKeys(sections)),
    handlers: { ...tiles.handlers, onFocusTile: setActiveKey },
  }
  return (
    <div ref={containerRef} className="flex flex-col gap-8" onKeyDown={handleKeyDown}>
      {sections.map((section) => (
        <ConnectionSection
          key={section.key}
          section={section}
          tiles={sectionTiles}
          groupContext={{ groups: groups, onGroupContextMenu: menu.openForGroup }}
        />
      ))}
    </div>
  )
}

const BOARD_BODY: Record<BoardState, (props: BoardBodyProps) => ReactNode> = {
  loading: () => <BoardSkeleton />,
  failed: (props) => <BoardLoadError message={props.loadError} onRetry={props.onRetry} />,
  empty: (props) => <BoardEmpty onNewConnection={props.onNewConnection} />,
  'no-match': (props) => <BoardNoMatch query={props.query} onClear={props.onClearFilter} />,
  url: () => null,
  sections: SectionsBody,
}

interface BoardHeaderProps {
  savedCount: number
  onNewGroup: () => void
  onNewConnection: () => void
}

function BoardHeader({ savedCount, onNewGroup, onNewConnection }: BoardHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-headline text-title font-semibold text-light-on-surface dark:text-dark-on-surface">
          Connections
        </h1>
        <span className="text-body text-light-on-surface-variant dark:text-dark-on-surface-variant">
          {savedServersLabel(savedCount)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="subtle" onClick={onNewGroup}>
          <FolderPlus size={PAGE_ICON_SIZE} aria-hidden className="shrink-0" />
          New group
        </Button>
        <Button onClick={onNewConnection}>
          <Plus size={PAGE_ICON_SIZE} aria-hidden className="shrink-0" />
          New connection
        </Button>
      </div>
    </header>
  )
}

function NewGroupHeading({ groups }: { groups: GroupEditing }) {
  const name = groups.newGroupName
  if (name === null) return null
  return (
    <SectionHeading>
      <GroupInlineInput
        value={name}
        onChange={groups.changeNewGroupName}
        onCommit={() => void groups.commitCreate()}
        onCancel={groups.cancelCreate}
        placeholder="Group name"
        ariaLabel="New group name"
      />
    </SectionHeading>
  )
}

function DeleteConnectionDialog({ tileActions }: { tileActions: TileActions }) {
  const pendingDelete = tileActions.pendingDelete
  return (
    <ConfirmDialog
      isOpen={pendingDelete !== null}
      title="Delete connection?"
      message={`“${pendingDelete?.item.name ?? ''}” will be removed from this device.`}
      confirmLabel="Delete"
      isDestructive
      isLoading={pendingDelete?.isDeleting ?? false}
      error={pendingDelete?.error ?? null}
      onConfirm={() => void tileActions.confirmDelete()}
      onCancel={tileActions.cancelDelete}
    />
  )
}

function hasOpenSessionInGroup(groupId: string | undefined): boolean {
  const { savedConnections, activeConnections } = useConnectionStore.getState()
  const memberIds = new Set(
    savedConnections
      .filter((connection) => connection.groupId === groupId)
      .map((connection) => connection.id)
  )
  return Object.values(activeConnections).some((session) => memberIds.has(session.profile.id))
}

function DeleteGroupMessage({ groupId }: { groupId: string | undefined }) {
  return (
    <>
      <p>Its connections move to Ungrouped. No connections are deleted.</p>
      {hasOpenSessionInGroup(groupId) && (
        <p className="mt-2">Open sessions for these connections will lose the group colour.</p>
      )}
    </>
  )
}

function DeleteGroupDialog({ groups }: { groups: GroupEditing }) {
  const pendingDelete = groups.pendingDelete
  return (
    <ConfirmDialog
      isOpen={pendingDelete !== null}
      title={`Delete group “${pendingDelete?.item.name ?? ''}”?`}
      message={<DeleteGroupMessage groupId={pendingDelete?.item.id} />}
      warningText={null}
      confirmLabel="Delete group"
      isDestructive
      initialFocus="cancel"
      isLoading={pendingDelete?.isDeleting ?? false}
      error={pendingDelete?.error ?? null}
      onConfirm={() => void groups.confirmDelete()}
      onCancel={groups.cancelDelete}
    />
  )
}

function loadErrorOf(load: SavedConnectionsLoad): string {
  return load.status === 'failed' ? load.message : ''
}

function useBoardContent(composerText: string) {
  const savedConnections = useConnectionStore((state) => state.savedConnections)
  const connectionGroups = useConnectionStore((state) => state.connectionGroups)
  const load = useConnectionStore((state) => state.savedConnectionsLoad)
  const parsed = parseConnectionComposerText(composerText)
  const query = parsed.kind === 'search' ? parsed.query : ''
  const sections = buildBoardSections({
    savedConnections: savedConnections,
    connectionGroups: connectionGroups,
    query: query,
  })
  const boardState = boardStateOf({
    load: load,
    composer: parsed,
    savedCount: savedConnections.length,
    visibleCount: visibleConnectionCount(sections),
  })
  return {
    parsed: parsed,
    query: query,
    sections: sections,
    boardState: boardState,
    savedCount: savedConnections.length,
    loadError: loadErrorOf(load),
  }
}

function boardTiles(
  tileActions: TileActions,
  menu: BoardMenu
): Omit<BoardTiles, 'activeConnections'> {
  return {
    statusOf: tileActions.statusOf,
    handlers: {
      onActivate: (connection) => void tileActions.activate(connection),
      onOpenNewSession: (connection) => void tileActions.openNewSession(connection),
      onEdit: tileActions.edit,
      onMore: menu.openForConnection,
      onContextMenu: menu.openForTileContextMenu,
      onSubmitPassword: (connection, submission) =>
        void tileActions.submitPassword(connection, submission),
    },
  }
}

export function ConnectionsBoard() {
  const [composerText, setComposerText] = useState('')
  const content = useBoardContent(composerText)
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  const fetchSavedConnections = useConnectionStore((state) => state.fetchSavedConnections)
  const showProfile = useConnectionsPageStore((state) => state.showProfile)
  const tileActions = useTileActions()
  const groups = useGroupEditing()
  const menu = useBoardMenu({ tileActions: tileActions, groups: groups })
  const urlImport = useUrlImport(() => setComposerText(''))
  const startNewConnection = () => showProfile({ kind: 'new', seed: null })
  const Body = BOARD_BODY[content.boardState]

  return (
    <PageFrame>
      <BackToSession />
      <BoardHeader
        savedCount={content.savedCount}
        onNewGroup={groups.startCreate}
        onNewConnection={startNewConnection}
      />
      <ConnectionComposer
        text={composerText}
        parsed={content.parsed}
        urlImport={urlImport}
        onTextChange={setComposerText}
      />
      <NewGroupHeading groups={groups} />
      <Body
        sections={content.sections}
        query={content.query}
        loadError={content.loadError}
        tiles={{ activeConnections: activeConnections, ...boardTiles(tileActions, menu) }}
        groups={groups}
        menu={menu}
        onRetry={() => void fetchSavedConnections()}
        onNewConnection={startNewConnection}
        onClearFilter={() => setComposerText('')}
      />
      {menu.menu && (
        <SavedConnectionsContextMenu menu={menu.menu} actions={menu.actions} onClose={menu.close} />
      )}
      <DeleteConnectionDialog tileActions={tileActions} />
      <DeleteGroupDialog groups={groups} />
      <span className="sr-only" role="status" aria-live="polite">
        {tileActions.announcement}
      </span>
    </PageFrame>
  )
}
