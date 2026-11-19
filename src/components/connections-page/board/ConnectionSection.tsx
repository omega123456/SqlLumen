import { useRef, type MouseEvent, type ReactNode } from 'react'
import { ClockCounterClockwise, PencilSimple } from '@phosphor-icons/react'
import { IconButton } from '../../common/IconButton'
import { useConnectionStore } from '../../../stores/connection-store'
import type { ActiveConnection } from '../../../types/connection'
import { PAGE_ICON_SIZE } from '../page-icons'
import { GroupEditPopover, type GroupEditorActions } from './GroupEditPopover'
import { ConnectionTile, type TileHandlers } from './ConnectionTile'
import { isProfileOpen, tileKey, type BoardSection } from './board-model'
import type { TileStatus } from './use-tile-actions'
import type { GroupEditing } from './use-group-editing'

export interface SectionTileContext {
  activeConnections: Record<string, ActiveConnection>
  focusTargetKey: string | null
  statusOf: (profileId: string) => TileStatus
  handlers: TileHandlers
}

export interface SectionGroupContext {
  groups: GroupEditing
  onGroupContextMenu: (event: MouseEvent, groupId: string) => void
}

interface ConnectionSectionProps {
  section: BoardSection
  tiles: SectionTileContext
  groupContext: SectionGroupContext
}

interface SectionHeadingProps {
  icon?: ReactNode
  trailing?: ReactNode
  children: ReactNode
}

export function SectionHeading({ icon, trailing, children }: SectionHeadingProps) {
  return (
    <div className="relative flex min-h-6 items-center gap-2 text-light-on-surface dark:text-dark-on-surface">
      {icon}
      {children}
      <span
        className="ml-2 h-px flex-1 bg-light-stroke-divider dark:bg-dark-stroke-divider"
        aria-hidden
      />
      {trailing}
    </div>
  )
}

function GroupDot({ groupId }: { groupId: string | null }) {
  const color = useConnectionStore(
    (state) => state.connectionGroups.find((group) => group.id === groupId)?.color ?? null
  )
  if (color === null) return null
  return (
    <span
      className="size-3 shrink-0 rounded-round"
      style={{ backgroundColor: color }}
      aria-hidden
    />
  )
}

function SectionTitle({ section }: { section: BoardSection }) {
  return (
    <>
      <GroupDot groupId={section.groupId} />
      <h2 className="truncate text-body font-semibold" title={section.title}>
        {section.title}
      </h2>
      <span className="text-body text-light-on-surface-variant dark:text-dark-on-surface-variant">
        {section.connections.length}
      </span>
    </>
  )
}

function groupMenuHandler(section: BoardSection, groupContext: SectionGroupContext) {
  const groupId = section.groupId
  if (groupId === null) return undefined
  return (event: MouseEvent) => groupContext.onGroupContextMenu(event, groupId)
}

function sectionIcon(section: BoardSection): ReactNode {
  if (section.kind !== 'recent') return null
  return <ClockCounterClockwise size={PAGE_ICON_SIZE} aria-hidden />
}

interface GroupEditControlProps {
  groupId: string
  title: string
  groups: GroupEditing
}

interface EditorActionSources {
  groupId: string
  groups: GroupEditing
}

function editorActionsFor({ groupId, groups }: EditorActionSources) {
  const actions: GroupEditorActions = {
    onRename: groups.rename,
    onRecolour: groups.recolour,
    onClose: (closing) => void groups.closeEditor(closing),
    onDismiss: () => void groups.closeEditor('save'),
    onDelete: () => groups.requestDelete(groupId),
  }
  return actions
}

function GroupEditControl({ groupId, title, groups }: GroupEditControlProps) {
  const pencilRef = useRef<HTMLButtonElement>(null)
  const draft = groups.draft
  const isEditingThisGroup = draft?.group.id === groupId
  return (
    <>
      <IconButton
        ref={pencilRef}
        size="sm"
        tone="mutedAccentOnHover"
        aria-label={`Edit group ${title}`}
        aria-haspopup="dialog"
        aria-expanded={isEditingThisGroup}
        title="Edit group"
        onClick={() => groups.openEditor(groupId)}
      >
        <PencilSimple size={PAGE_ICON_SIZE} />
      </IconButton>
      {isEditingThisGroup && draft && (
        <GroupEditPopover
          draft={draft}
          actions={editorActionsFor({ groupId: groupId, groups: groups })}
          returnFocusRef={pencilRef}
        />
      )}
    </>
  )
}

function SectionTrailing({ section, groups }: { section: BoardSection; groups: GroupEditing }) {
  if (section.kind !== 'group') return null
  if (section.groupId === null) return null
  return <GroupEditControl groupId={section.groupId} title={section.title} groups={groups} />
}

function EmptyGroupNote({ section }: { section: BoardSection }) {
  const isEmptyGroup = section.kind === 'group' && section.connections.length === 0
  if (!isEmptyGroup) return null
  return (
    <p className="text-body text-light-on-surface-variant dark:text-dark-on-surface-variant">
      No connections in this group yet. Move a connection here from its More actions menu.
    </p>
  )
}

export function ConnectionSection({ section, tiles, groupContext }: ConnectionSectionProps) {
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={section.title}
      data-testid={`connection-section-${section.key}`}
      onContextMenu={groupMenuHandler(section, groupContext)}
    >
      <SectionHeading
        icon={sectionIcon(section)}
        trailing={<SectionTrailing section={section} groups={groupContext.groups} />}
      >
        <SectionTitle section={section} />
      </SectionHeading>
      <EmptyGroupNote section={section} />
      <ul className="grid grid-cols-connection-tiles gap-3">
        {section.connections.map((connection) => {
          const key = tileKey(section, connection)
          return (
            <ConnectionTile
              key={key}
              connection={connection}
              tileKey={key}
              isFocusTarget={key === tiles.focusTargetKey}
              isOpen={isProfileOpen(tiles.activeConnections, connection.id)}
              status={tiles.statusOf(connection.id)}
              handlers={tiles.handlers}
            />
          )
        })}
      </ul>
    </section>
  )
}
