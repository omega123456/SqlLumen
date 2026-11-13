import { invokeArgumentCommand, invokeCommand, NO_ARGUMENTS } from './ipc/dispatch'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryScope = 'connection' | 'group' | 'global'

const MEMORY_SCOPES: ReadonlySet<unknown> = new Set<MemoryScope>(['global', 'group', 'connection'])

export function isMemoryScope(value: unknown): value is MemoryScope {
  return MEMORY_SCOPES.has(value)
}

export interface AiMemory {
  id: number
  scope: MemoryScope
  connectionId: string | null
  groupId: string | null
  content: string
  createdAt: number
  source: string
}

export interface MemoryReembedProgress {
  ownerKey: string
  phase: 'embedding' | 'done' | 'error'
  done: number
  total: number
  error?: string
}

export interface SaveMemoryRequest {
  sessionId: string
  content: string
  scope: MemoryScope
}

export interface DeleteMemoryRequest {
  scope: MemoryScope
  memoryId: number
}

export interface MoveMemoryRequest {
  memoryId: number
  fromScope: MemoryScope
  toScope: MemoryScope
  toGroupId?: string
  toConnectionId?: string
  fromGroupId?: string
  fromConnectionId?: string
}

export interface SearchMemoriesRequest {
  sessionId: string
  query: string
  limit: number
}

export async function saveMemory(request: SaveMemoryRequest): Promise<AiMemory> {
  return invokeCommand({ command: 'save_memory', payload: request })
}

export async function listGlobalMemories(): Promise<AiMemory[]> {
  return invokeArgumentCommand({ command: 'list_global_memories', argument: NO_ARGUMENTS })
}

export async function listGroupMemories(argument: { groupId: string }): Promise<AiMemory[]> {
  return invokeArgumentCommand({ command: 'list_group_memories', argument: argument })
}

export async function listConnectionMemories(argument: {
  connectionId: string
}): Promise<AiMemory[]> {
  return invokeArgumentCommand({ command: 'list_connection_memories', argument: argument })
}

export async function deleteMemory(request: DeleteMemoryRequest): Promise<void> {
  return invokeCommand({ command: 'delete_memory', payload: request })
}

export async function moveMemory(request: MoveMemoryRequest): Promise<AiMemory> {
  return invokeCommand({ command: 'move_memory', payload: request })
}

export async function searchMemories(request: SearchMemoriesRequest): Promise<AiMemory[]> {
  return invokeCommand({ command: 'search_memories', payload: request })
}

export async function reembedAllMemories(): Promise<void> {
  return invokeArgumentCommand({ command: 'reembed_all_memories', argument: NO_ARGUMENTS })
}
