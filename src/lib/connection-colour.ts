import type { ActiveConnection, ConnectionGroup, SavedConnection } from '../types/connection'

export type ConnectionColouring = Pick<SavedConnection, 'color' | 'groupId'>

export type ColouredProfile = Pick<SavedConnection, 'id' | 'color' | 'groupId'>

export interface ColourSources {
  savedConnections: SavedConnection[]
  connectionGroups: ConnectionGroup[]
}

export function connectionGroupOf(
  colouring: ConnectionColouring,
  connectionGroups: ConnectionGroup[]
): ConnectionGroup | null {
  return connectionGroups.find((group) => group.id === colouring.groupId) ?? null
}

export function colourWithGroup(
  colouring: ConnectionColouring,
  connectionGroups: ConnectionGroup[]
): string | null {
  if (colouring.color) return colouring.color
  return connectionGroupOf(colouring, connectionGroups)?.color ?? null
}

export function liveColouring(
  profile: ColouredProfile,
  savedConnections: SavedConnection[]
): ConnectionColouring {
  return savedConnections.find((saved) => saved.id === profile.id) ?? profile
}

export function effectiveConnectionColour(
  profile: ColouredProfile,
  sources: ColourSources
): string | null {
  const colouring = liveColouring(profile, sources.savedConnections)
  return colourWithGroup(colouring, sources.connectionGroups)
}

export function liveConnectionGroup(
  profile: ColouredProfile,
  sources: ColourSources
): ConnectionGroup | null {
  const colouring = liveColouring(profile, sources.savedConnections)
  return connectionGroupOf(colouring, sources.connectionGroups)
}

export function sessionColour(
  session: ActiveConnection | undefined,
  sources: ColourSources
): string | null {
  if (!session) return null
  return effectiveConnectionColour(session.profile, sources)
}
