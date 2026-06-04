import { DotsSixVerticalIcon, TrashIcon } from '@phosphor-icons/react'
import { IconButton } from '../../common/IconButton'
import { formatFromEpochSeconds } from '../../../lib/format-utils'
import type { AiMemory, MemoryScope } from '../../../lib/ai-memory-commands'
import styles from './MemoryRow.module.css'

/** A drag payload identifying a memory and the scope/owner it currently lives at. */
export interface MemoryDragPayload {
  memoryId: number
  fromScope: MemoryScope
  fromConnectionId?: string | null
  fromGroupId?: string | null
}

export const MEMORY_DRAG_MIME_TYPE = 'application/x-sqllumen-ai-memory'

export interface MemoryRowProps {
  memory: AiMemory
  /** Owner identity of the section this row lives in (for the drag payload). */
  source: MemoryDragPayload
  onRequestDelete: (memory: AiMemory) => void
  onDragStart: (payload: MemoryDragPayload) => void
  onDragEnd: () => void
  /** True while this row is the active drag source. */
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
      className={`${styles.row} ${isDragging ? styles.dragging : ''}`}
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
      <span className={styles.dragHandle} aria-hidden data-testid={`ai-memory-drag-${memory.id}`}>
        <DotsSixVerticalIcon size={16} weight="bold" />
      </span>
      <div className={styles.content}>
        <div className={styles.text}>{memory.content}</div>
        <div className={styles.date}>{`Saved ${formatFromEpochSeconds(memory.createdAt)}`}</div>
      </div>
      <div className={styles.actions}>
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
