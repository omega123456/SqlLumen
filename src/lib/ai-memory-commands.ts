import { invoke } from '@tauri-apps/api/core'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiMemory {
  id: number
  connectionId: string
  content: string
  createdAt: number
  source: string
}

export interface MemoryReembedProgress {
  connectionId: string
  phase: 'embedding' | 'done' | 'error'
  done: number
  total: number
  error?: string
}

// ---------------------------------------------------------------------------
// IPC wrappers
// ---------------------------------------------------------------------------

export async function saveMemory(args: { sessionId: string; content: string }): Promise<AiMemory> {
  return invoke('save_memory', args)
}

export async function listMemories(args: { connectionId: string }): Promise<AiMemory[]> {
  return invoke('list_memories', args)
}

export async function deleteMemory(args: { memoryId: number }): Promise<void> {
  return invoke('delete_memory', args)
}

export async function searchMemories(args: {
  sessionId: string
  query: string
  k: number
}): Promise<AiMemory[]> {
  return invoke('search_memories', args)
}

export async function reembedMemories(args: { connectionId: string }): Promise<void> {
  return invoke('reembed_memories', args)
}
