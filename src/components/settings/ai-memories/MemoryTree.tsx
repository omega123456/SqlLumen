import { MemorySection } from '../memory/MemorySection'
import type { AiMemory, MemoryScope } from '../../../lib/ai-memory-commands'
import type { ConnectionGroup, SavedConnection } from '../../../types/connection'
import type { MemoryStore } from './memory-store'
import type { MemoryDragState } from './use-memory-drag-state'
import { joinClassNames } from '../../../lib/class-names'
import { SETTINGS_MEMORY_NEST, SETTINGS_MEMORY_PANEL } from '../../../lib/class-names-settings'

const NO_MEMORIES: AiMemory[] = []

export interface MemoryTreeHandlers {
  dragState: MemoryDragState
  onRequestDelete: (memory: AiMemory) => void
  onAdd: (scope: MemoryScope, content: string, ownerId?: string) => Promise<void>
}

interface ConnectionMemorySectionProps {
  connection: SavedConnection
  memories: MemoryStore
  handlers: MemoryTreeHandlers
}

function ConnectionMemorySection({ connection, memories, handlers }: ConnectionMemorySectionProps) {
  return (
    <MemorySection
      sectionKey={`connection-${connection.id}`}
      scope="connection"
      label={connection.name}
      connectionId={connection.id}
      nested
      subdued
      memories={memories.connection[connection.id] ?? NO_MEMORIES}
      onRequestDelete={handlers.onRequestDelete}
      onAdd={(content) => handlers.onAdd('connection', content, connection.id)}
      {...handlers.dragState}
    />
  )
}

interface GroupMemorySectionProps {
  group: ConnectionGroup
  groupConnections: SavedConnection[]
  memories: MemoryStore
  handlers: MemoryTreeHandlers
}

function GroupMemorySection(props: GroupMemorySectionProps) {
  const { group, memories, handlers } = props
  return (
    <MemorySection
      sectionKey={`group-${group.id}`}
      scope="group"
      label={group.name}
      groupId={group.id}
      memories={memories.group[group.id] ?? NO_MEMORIES}
      collapsible
      nested
      onRequestDelete={handlers.onRequestDelete}
      onAdd={(content) => handlers.onAdd('group', content, group.id)}
      {...handlers.dragState}
    >
      {props.groupConnections.map((connection) => (
        <ConnectionMemorySection
          key={connection.id}
          connection={connection}
          memories={memories}
          handlers={handlers}
        />
      ))}
    </MemorySection>
  )
}

interface UngroupedMemoryBlockProps {
  connections: SavedConnection[]
  memories: MemoryStore
  handlers: MemoryTreeHandlers
}

function UngroupedMemoryBlock({ connections, memories, handlers }: UngroupedMemoryBlockProps) {
  if (connections.length === 0) return null
  return (
    <div className={joinClassNames(['mt-1', SETTINGS_MEMORY_NEST])}>
      <div
        className="mb-0.5 rounded-control bg-light-surface-container-high px-2 py-1.5 text-size-caption font-semibold text-light-on-surface-variant dark:bg-dark-surface-container-high dark:text-dark-on-surface-variant"
        data-testid="ai-memory-ungrouped-label"
      >
        No group
      </div>
      {connections.map((connection) => (
        <ConnectionMemorySection
          key={connection.id}
          connection={connection}
          memories={memories}
          handlers={handlers}
        />
      ))}
    </div>
  )
}

interface MemoryTreeProps {
  memories: MemoryStore
  connectionGroups: ConnectionGroup[]
  savedConnections: SavedConnection[]
  handlers: MemoryTreeHandlers
}

export function MemoryTree({
  memories,
  connectionGroups,
  savedConnections,
  handlers,
}: MemoryTreeProps) {
  const ungroupedConnections = savedConnections.filter((connection) => !connection.groupId)
  return (
    <div className={joinClassNames(['flex flex-col p-3', SETTINGS_MEMORY_PANEL])}>
      <MemorySection
        sectionKey="global"
        scope="global"
        label="Global"
        memories={memories.global}
        onRequestDelete={handlers.onRequestDelete}
        onAdd={(content) => handlers.onAdd('global', content)}
        {...handlers.dragState}
      />
      {connectionGroups.map((group) => (
        <GroupMemorySection
          key={group.id}
          group={group}
          groupConnections={savedConnections.filter(
            (connection) => connection.groupId === group.id
          )}
          memories={memories}
          handlers={handlers}
        />
      ))}
      <UngroupedMemoryBlock
        connections={ungroupedConnections}
        memories={memories}
        handlers={handlers}
      />
    </div>
  )
}
