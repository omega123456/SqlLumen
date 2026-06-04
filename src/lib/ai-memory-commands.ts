import { invoke } from '@tauri-apps/api/core'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryScope = 'connection' | 'group' | 'global'

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

// ---------------------------------------------------------------------------
// IPC wrappers
// ---------------------------------------------------------------------------

export async function saveMemory(args: {
  sessionId: string
  content: string
  scope: MemoryScope
}): Promise<AiMemory> {
  return invoke('save_memory', args)
}

export async function listGlobalMemories(): Promise<AiMemory[]> {
  return invoke('list_global_memories')
}

export async function listGroupMemories(args: { groupId: string }): Promise<AiMemory[]> {
  return invoke('list_group_memories', args)
}

export async function listConnectionMemories(args: {
  connectionId: string
}): Promise<AiMemory[]> {
  return invoke('list_connection_memories', args)
}

export async function deleteMemory(args: {
  scope: MemoryScope
  memoryId: number
}): Promise<void> {
  return invoke('delete_memory', args)
}

export async function moveMemory(args: {
  memoryId: number
  fromScope: MemoryScope
  toScope: MemoryScope
  toGroupId?: string
  toConnectionId?: string
  fromGroupId?: string
  fromConnectionId?: string
}): Promise<AiMemory> {
  return invoke('move_memory', args)
}

export async function searchMemories(args: {
  sessionId: string
  query: string
  k: number
}): Promise<AiMemory[]> {
  return invoke('search_memories', args)
}

export async function reembedAllMemories(): Promise<void> {
  return invoke('reembed_all_memories')
}
