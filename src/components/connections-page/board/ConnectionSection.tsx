import type { MouseEvent, ReactNode } from 'react'
import { ClockCounterClockwise } from '@phosphor-icons/react'
import type { ActiveConnection } from '../../../types/connection'
import { PAGE_ICON_SIZE } from '../page-icons'
import { GroupInlineInput } from './GroupInlineInput'
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

export function SectionHeading({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-light-on-surface dark:text-dark-on-surface">
      {icon}
      {children}
      <span
        className="ml-2 h-px flex-1 bg-light-stroke-divider dark:bg-dark-stroke-divider"
        aria-hidden
      />
    </div>
  )
}

function renameValueOf(section: BoardSection, groups: GroupEditing): string | null {
  const editing = groups.editingGroup
  if (editing?.mode !== 'rename') return null
  if (editing.groupId !== section.groupId) return null
  return editing.value
}

function SectionTitle({ section, groupContext }: Omit<ConnectionSectionProps, 'tiles'>) {
  const { groups } = groupContext
  const renameValue = renameValueOf(section, groups)
  if (renameValue !== null) {
    return (
      <GroupInlineInput
        value={renameValue}
        onChange={groups.changeValue}
        onCommit={() => void groups.commitEditing()}
        onCancel={groups.cancelEditing}
        ariaLabel="Group name"
      />
    )
  }
  return (
    <>
      <h2 className="text-body font-semibold">{section.title}</h2>
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

export function ConnectionSection({ section, tiles, groupContext }: ConnectionSectionProps) {
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={section.title}
      data-testid={`connection-section-${section.key}`}
      onContextMenu={groupMenuHandler(section, groupContext)}
    >
      <SectionHeading icon={sectionIcon(section)}>
        <SectionTitle section={section} groupContext={groupContext} />
      </SectionHeading>
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
