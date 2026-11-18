import Fuse from 'fuse.js'
import type { ConnectionGroup, SavedConnection } from '../../../types/connection'

export interface ConnectionSection {
  groupId: string | null
  groupName: string | null
  sortOrder: number
  connections: SavedConnection[]
}

export function buildConnectionSections(
  savedConnections: SavedConnection[],
  connectionGroups: ConnectionGroup[]
): ConnectionSection[] {
  const sortedGroups = [...connectionGroups].sort((left, right) => left.sortOrder - right.sortOrder)

  const connectionsByGroup = new Map<string | null, SavedConnection[]>()
  for (const group of sortedGroups) {
    connectionsByGroup.set(group.id, [])
  }
  const ungroupedConnections: SavedConnection[] = []
  connectionsByGroup.set(null, ungroupedConnections)

  for (const connection of savedConnections) {
    const bucket = connectionsByGroup.get(connection.groupId) ?? ungroupedConnections
    bucket.push(connection)
  }

  for (const [, connections] of connectionsByGroup) {
    connections.sort((left, right) => left.name.localeCompare(right.name))
  }

  const sections: ConnectionSection[] = sortedGroups.map((group) => ({
    groupId: group.id,
    groupName: group.name,
    sortOrder: group.sortOrder,
    connections: connectionsByGroup.get(group.id) ?? [],
  }))

  sections.push({
    groupId: null,
    groupName: null,
    sortOrder: Infinity,
    connections: connectionsByGroup.get(null) ?? [],
  })

  return sections
}

export function filterConnectionsByQuery(
  savedConnections: SavedConnection[],
  query: string
): SavedConnection[] {
  const trimmed = query.trim()
  if (!trimmed) {
    return savedConnections
  }

  const fuse = new Fuse(savedConnections, {
    keys: ['name', 'host'],
    threshold: 0,
    ignoreLocation: true,
    isCaseSensitive: false,
  })

  return fuse.search(trimmed).map((result) => result.item)
}

export type EditingGroupState =
  { mode: 'rename'; groupId: string; value: string } | { mode: 'create'; value: string } | null

const UNGROUPED_SECTION_KEY = 'ungrouped'
const UNGROUPED_SECTION_TITLE = 'Ungrouped'

export interface GroupMutation {
  run: () => Promise<unknown>
  successTitle: string
  failureTitle: string
  groupName: string
}

interface SectionVisibilityInputs {
  section: ConnectionSection
  isFiltering: boolean
  isRenaming: boolean
}

export function shouldHideSection(inputs: SectionVisibilityInputs): boolean {
  const hasConnections = inputs.section.connections.length > 0
  if (hasConnections) return false
  if (inputs.isRenaming) return false
  const isGroupSection = inputs.section.groupId !== null
  return !isGroupSection || inputs.isFiltering
}

export function sectionKey(section: ConnectionSection): string {
  return section.groupId ?? UNGROUPED_SECTION_KEY
}

export function sectionTitle(section: ConnectionSection): string {
  return section.groupName ?? UNGROUPED_SECTION_TITLE
}
