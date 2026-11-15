import { DotsSixVerticalIcon, TrashIcon } from '@phosphor-icons/react'
import { IconButton } from '../../common/IconButton'
import { formatFromEpochSeconds } from '../../../lib/format-utils'
import type { AiMemory, MemoryScope } from '../../../lib/ai-memory-commands'
import { joinClassNames } from '../../../lib/class-names'

const DRAG_STATE_CLASSES: Record<'idle' | 'dragging', string> = {
  idle: '',
  dragging: 'opacity-50',
}

function dragStateOf(isDragging: boolean): 'idle' | 'dragging' {
  if (isDragging) return 'dragging'
  return 'idle'
}

export interface MemoryDragPayload {
  memoryId: number
  fromScope: MemoryScope
  fromConnectionId?: string | null
  fromGroupId?: string | null
}

export const MEMORY_DRAG_MIME_TYPE = 'application/x-sqllumen-ai-memory'

export interface MemoryRowProps {
  memory: AiMemory
  source: MemoryDragPayload
  onRequestDelete: (memory: AiMemory) => void
  onDragStart: (payload: MemoryDragPayload) => void
  onDragEnd: () => void
  isDragging: boolean
}

export function MemoryRow({
  memory,
  source,
  onRequestDelete,
  onDragStart,
  onDragEnd,
  isDragging,
}: MemoryRowProps) {
  return (
    <div
      className={joinClassNames([
        'group/row relative flex cursor-grab items-center gap-2 rounded-control px-2 py-1.5 select-none hover:bg-light-surface-container-highest active:cursor-grabbing dark:hover:bg-dark-surface-container-highest',
        DRAG_STATE_CLASSES[dragStateOf(isDragging)],
      ])}
      data-testid={`ai-memory-item-${memory.id}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData(MEMORY_DRAG_MIME_TYPE, JSON.stringify(source))
        event.dataTransfer.setData('text/plain', String(memory.id))
        onDragStart(source)
      }}
      onDragEnd={onDragEnd}
    >
      <span
        className="flex h-5.5 w-5 shrink-0 cursor-grab items-center justify-center text-light-on-surface-variant opacity-0 transition-opacity duration-120 group-hover/row:opacity-100 active:cursor-grabbing dark:text-dark-on-surface-variant"
        aria-hidden
        data-testid={`ai-memory-drag-${memory.id}`}
      >
        <DotsSixVerticalIcon size={16} weight="bold" />
      </span>
      <div className="min-w-0 flex-1 pt-px">
        <div className="text-size-caption leading-body wrap-anywhere text-light-on-surface dark:text-dark-on-surface">
          {memory.content}
        </div>
        <div className="mt-0.5 text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
          {`Saved ${formatFromEpochSeconds(memory.createdAt)}`}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-120 group-hover/row:opacity-100 focus-within:opacity-100">
        <IconButton
          size="sm"
          aria-label="Delete memory"
          data-testid={`ai-memory-delete-${memory.id}`}
          onClick={() => onRequestDelete(memory)}
        >
          <TrashIcon size={16} />
        </IconButton>
      </div>
    </div>
  )
}
