import type { ActiveConnection } from '../../types/connection'

export function normalizeActiveConnectionOrder(
  activeConnectionOrder: string[],
  activeConnections: Record<string, ActiveConnection>
): string[] {
  const candidateIds = [...activeConnectionOrder, ...Object.keys(activeConnections)]
  const openIds = candidateIds.filter((sessionId) => activeConnections[sessionId])
  return [...new Set(openIds)]
}

export function isConnectionOfProfile(connection: ActiveConnection, profileId: string): boolean {
  return connection.profile.id === profileId
}
