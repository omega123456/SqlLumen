import { MEMORY_DRAG_MIME_TYPE, type MemoryDragPayload } from './MemoryRow'
import type { MemoryScope } from '../../../lib/ai-memory-commands'
import { isMemoryScope } from '../../../lib/ai-memory-commands'
import { logParseFallback } from '../../../lib/app-log-commands'

export interface MemoryOwner {
  scope: MemoryScope
  connectionId?: string
  groupId?: string
}

export interface MemoryDropCandidate {
  scope: MemoryScope
  connectionId: string | undefined
  groupId: string | undefined
  payload: MemoryDragPayload | null
}

export function isDropAccepted({
  scope,
  connectionId,
  groupId,
  payload,
}: MemoryDropCandidate): boolean {
  if (!payload) return false
  if (payload.fromScope === scope) {
    if (scope === 'global') return false
    if (scope === 'connection') return (payload.fromConnectionId ?? null) !== (connectionId ?? null)
    if (scope === 'group') return (payload.fromGroupId ?? null) !== (groupId ?? null)
  }
  return true
}

function ownerIdOrUndefined(value: unknown): string | null | undefined {
  if (typeof value === 'string') return value
  if (value === null) return null
  return undefined
}

export function parseDragPayload(dataTransfer: DataTransfer): MemoryDragPayload | null {
  try {
    const raw = dataTransfer.getData(MEMORY_DRAG_MIME_TYPE)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<MemoryDragPayload>
    if (typeof parsed.memoryId !== 'number') return null
    if (!isMemoryScope(parsed.fromScope)) return null
    return {
      memoryId: parsed.memoryId,
      fromScope: parsed.fromScope,
      fromConnectionId: ownerIdOrUndefined(parsed.fromConnectionId),
      fromGroupId: ownerIdOrUndefined(parsed.fromGroupId),
    }
  } catch (error) {
    logParseFallback('[memory-section] parseDragPayload', error)
    return null
  }
}

export function hasMemoryDragType(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(MEMORY_DRAG_MIME_TYPE)
}
