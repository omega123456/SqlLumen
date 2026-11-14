import { useCallback, useRef, useState } from 'react'
import type { MemoryDragPayload } from '../memory/MemoryRow'
import type { MemoryOwner } from '../memory/memory-section-model'
import { findDraggedMemory, type MemoryStore } from './memory-store'
import type { MemoryMove } from './use-memory-actions'

export function useMemoryDragState(
  memories: MemoryStore,
  performMove: (move: MemoryMove) => Promise<void>
) {
  const [activeDrag, setActiveDrag] = useState<MemoryDragPayload | null>(null)
  const activeDragRef = useRef<MemoryDragPayload | null>(null)
  const [hoverKey, setHoverKey] = useState<string | null>(null)

  const clearDrag = useCallback(() => {
    activeDragRef.current = null
    setActiveDrag(null)
    setHoverKey(null)
  }, [])

  const handleDrop = useCallback(
    (target: MemoryOwner, payload: MemoryDragPayload) => {
      const memory = findDraggedMemory(memories, payload)
      clearDrag()
      if (!memory) return
      void performMove({ memory: memory, fromScope: payload.fromScope, target: target })
    },
    [memories, performMove, clearDrag]
  )

  return {
    activeDrag: activeDrag,
    getActiveDrag: () => activeDragRef.current,
    hoverKey: hoverKey,
    onHover: setHoverKey,
    onDragStart: (payload: MemoryDragPayload) => {
      activeDragRef.current = payload
      setActiveDrag(payload)
    },
    onDragEnd: clearDrag,
    onDrop: handleDrop,
  }
}

export type MemoryDragState = ReturnType<typeof useMemoryDragState>
