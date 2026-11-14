import type { MemoryDragPayload } from '../memory/MemoryRow'
import {
  listConnectionMemories,
  listGlobalMemories,
  listGroupMemories,
} from '../../../lib/ai-memory-commands'
import type { AiMemory, MemoryScope } from '../../../lib/ai-memory-commands'
import { logFrontend } from '../../../lib/app-log-commands'
import { isConnectionOfProfile } from '../../../stores/connection-store'
import type { ActiveConnection, ConnectionGroup, SavedConnection } from '../../../types/connection'

export interface MemoryStore {
  global: AiMemory[]
  group: Record<string, AiMemory[]>
  connection: Record<string, AiMemory[]>
}

export const EMPTY_MEMORY_STORE: MemoryStore = { global: [], group: {}, connection: {} }

const NO_MEMORIES: AiMemory[] = []

function isConnectionInGroup(connection: ActiveConnection, groupId: string): boolean {
  return connection.profile.groupId === groupId
}

function findMemoryById(memories: AiMemory[] | undefined, memoryId: AiMemory['id']) {
  return memories?.find((candidate) => candidate.id === memoryId)
}

export function findDraggedMemory(
  memories: MemoryStore,
  payload: MemoryDragPayload
): AiMemory | undefined {
  if (payload.fromScope === 'global') return findMemoryById(memories.global, payload.memoryId)
  const sourceGroupId = payload.fromScope === 'group' ? payload.fromGroupId : null
  if (sourceGroupId) {
    return findMemoryById(memories.group[sourceGroupId], payload.memoryId)
  }
  const sourceConnectionId = payload.fromScope === 'connection' ? payload.fromConnectionId : null
  if (sourceConnectionId) {
    return findMemoryById(memories.connection[sourceConnectionId], payload.memoryId)
  }
  return undefined
}

interface SessionLookup {
  activeConnections: Record<string, ActiveConnection>
  scope: MemoryScope
  ownerId?: string
}

export function resolveSessionIdForOwner({
  activeConnections,
  scope,
  ownerId,
}: SessionLookup): string | null {
  const sessions = Object.entries(activeConnections)
  if (scope === 'global') return sessions[0]?.[0] ?? null
  if (ownerId === undefined) return null
  if (scope === 'connection') {
    const match = sessions.find(([, connection]) => isConnectionOfProfile(connection, ownerId))
    return match?.[0] ?? null
  }
  const match = sessions.find(([, connection]) => isConnectionInGroup(connection, ownerId))
  return match?.[0] ?? null
}

async function loadGlobalMemories(): Promise<AiMemory[]> {
  try {
    return await listGlobalMemories()
  } catch (error) {
    logFrontend('warn', `[AiMemoriesSettings] listGlobalMemories failed: ${String(error)}`)
    return NO_MEMORIES
  }
}

async function loadGroupMemories(group: ConnectionGroup): Promise<[string, AiMemory[]]> {
  try {
    return [group.id, await listGroupMemories({ groupId: group.id })]
  } catch (error) {
    logFrontend(
      'warn',
      `[AiMemoriesSettings] listGroupMemories failed for ${group.id}: ${String(error)}`
    )
    return [group.id, NO_MEMORIES]
  }
}

async function loadConnectionMemories(connection: SavedConnection): Promise<[string, AiMemory[]]> {
  try {
    return [connection.id, await listConnectionMemories({ connectionId: connection.id })]
  } catch (error) {
    logFrontend(
      'warn',
      `[AiMemoriesSettings] listConnectionMemories failed for ${connection.id}: ${String(error)}`
    )
    return [connection.id, NO_MEMORIES]
  }
}

export async function loadAllMemories(
  connectionGroups: ConnectionGroup[],
  savedConnections: SavedConnection[]
): Promise<MemoryStore> {
  const [global, groupEntries, connectionEntries] = await Promise.all([
    loadGlobalMemories(),
    Promise.all(connectionGroups.map(loadGroupMemories)),
    Promise.all(savedConnections.map(loadConnectionMemories)),
  ])
  return {
    global: global,
    group: Object.fromEntries(groupEntries),
    connection: Object.fromEntries(connectionEntries),
  }
}
