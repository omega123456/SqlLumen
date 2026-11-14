import type { DragEvent } from 'react'
import type { MemoryDragPayload } from './MemoryRow'
import { isTargetOutside } from '../../../lib/input-events'
import {
  hasMemoryDragType,
  isDropAccepted,
  parseDragPayload,
  type MemoryOwner,
} from './memory-section-model'

export interface MemoryDropTargetInputs {
  sectionKey: string
  owner: MemoryOwner
  activeDrag: MemoryDragPayload | null
  getActiveDrag: () => MemoryDragPayload | null
  hoverKey: string | null
  onHover: (key: string | null) => void
  onDrop: (target: MemoryOwner, payload: MemoryDragPayload) => void
}

function acceptsPayload(owner: MemoryOwner, payload: MemoryDragPayload | null): boolean {
  return isDropAccepted({
    scope: owner.scope,
    connectionId: owner.connectionId,
    groupId: owner.groupId,
    payload: payload,
  })
}

export function useMemoryDropTarget(inputs: MemoryDropTargetInputs) {
  const { sectionKey, owner, activeDrag, getActiveDrag, onHover } = inputs
  const isDragOver = inputs.hoverKey === sectionKey

  const resolveDragPayload = (dataTransfer: DataTransfer): MemoryDragPayload | null =>
    activeDrag ?? getActiveDrag() ?? parseDragPayload(dataTransfer)

  const handleDragOver = (event: DragEvent) => {
    const payload = resolveDragPayload(event.dataTransfer)
    const isMemoryDrag = payload !== null || hasMemoryDragType(event.dataTransfer)
    if (!isMemoryDrag) return
    event.stopPropagation()
    // Browsers only fire `drop` on elements whose `dragover` called preventDefault.
    event.preventDefault()
    const dropAccepted = payload ? acceptsPayload(owner, payload) : true
    event.dataTransfer.dropEffect = dropAccepted ? 'move' : 'none'
    const hoverChanged = dropAccepted !== isDragOver
    if (hoverChanged) onHover(dropAccepted ? sectionKey : null)
  }

  const handleDragLeave = (event: DragEvent) => {
    const hasLeftSection = isDragOver && isTargetOutside(event.currentTarget, event.relatedTarget)
    if (hasLeftSection) onHover(null)
  }

  const handleDrop = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    onHover(null)
    const payload = resolveDragPayload(event.dataTransfer)
    if (!payload) return
    if (!acceptsPayload(owner, payload)) return
    inputs.onDrop(owner, payload)
  }

  return { isDragOver, handleDragOver, handleDragLeave, handleDrop }
}
