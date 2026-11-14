import { useCallback, useState } from 'react'
import { useConnectionStore } from '../../../stores/connection-store'
import { deleteMemory, moveMemory, saveMemory } from '../../../lib/ai-memory-commands'
import type { AiMemory, MemoryScope } from '../../../lib/ai-memory-commands'
import { showErrorToast } from '../../../stores/toast-store'
import type { MemoryOwner } from '../memory/memory-section-model'
import { resolveSessionIdForOwner } from './memory-store'

const NO_SESSION_FOR_SCOPE_MESSAGE =
  'Open a connection in this scope to add a memory here (saving requires an active connection).'

function useAddMemory(loadMemories: () => Promise<void>) {
  const activeConnections = useConnectionStore((state) => state.activeConnections)
  return useCallback(
    async (scope: MemoryScope, content: string, ownerId?: string) => {
      const sessionId = resolveSessionIdForOwner({
        activeConnections: activeConnections,
        scope: scope,
        ownerId: ownerId,
      })
      if (!sessionId) {
        showErrorToast(NO_SESSION_FOR_SCOPE_MESSAGE)
        return
      }
      try {
        await saveMemory({ sessionId, content, scope })
        await loadMemories()
      } catch (error) {
        showErrorToast(`Failed to save memory: ${String(error)}`)
      }
    },
    [activeConnections, loadMemories]
  )
}

function useDeleteMemory(loadMemories: () => Promise<void>) {
  const [deleteTarget, setDeleteTarget] = useState<AiMemory | null>(null)
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    try {
      await deleteMemory({ scope: deleteTarget.scope, memoryId: deleteTarget.id })
      await loadMemories()
    } catch (error) {
      showErrorToast(`Failed to delete memory: ${String(error)}`)
    } finally {
      setDeleteTarget(null)
    }
  }, [deleteTarget, loadMemories])
  return { deleteTarget, setDeleteTarget, handleDeleteConfirm }
}

export interface MemoryMove {
  memory: AiMemory
  fromScope: MemoryScope
  target: MemoryOwner
}

function useMoveMemory(loadMemories: () => Promise<void>) {
  return useCallback(
    async ({ memory, fromScope, target }: MemoryMove) => {
      try {
        await moveMemory({
          memoryId: memory.id,
          fromScope: fromScope,
          toScope: target.scope,
          toGroupId: target.groupId,
          toConnectionId: target.connectionId,
          fromGroupId: memory.groupId ?? undefined,
          fromConnectionId: memory.connectionId ?? undefined,
        })
        await loadMemories()
      } catch (error) {
        showErrorToast(`Failed to move memory: ${String(error)}`)
      }
    },
    [loadMemories]
  )
}

export function useMemoryActions(loadMemories: () => Promise<void>) {
  return {
    handleAdd: useAddMemory(loadMemories),
    ...useDeleteMemory(loadMemories),
    performMove: useMoveMemory(loadMemories),
  }
}
