import { useEffect, useRef, useState } from 'react'
import {
  ArrowsOutCardinalIcon,
  DatabaseIcon,
  DotsSixVerticalIcon,
  FolderOpenIcon,
  GlobeIcon,
  TrashIcon,
} from '@phosphor-icons/react'
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

/** A destination the "Move to…" menu (and drag-and-drop) can target. */
export interface MoveDestination {
  /** Stable key for list rendering. */
  key: string
  scope: MemoryScope
  label: string
  connectionId?: string
  groupId?: string
}

export interface MemoryRowProps {
  memory: AiMemory
  /** Owner identity of the section this row lives in (for the drag payload). */
  source: MemoryDragPayload
  /** Valid move destinations (already excludes the current owner). */
  destinations: MoveDestination[]
  onRequestDelete: (memory: AiMemory) => void
  onMove: (memory: AiMemory, destination: MoveDestination) => void
  onDragStart: (payload: MemoryDragPayload) => void
  onDragEnd: () => void
  /** True while this row is the active drag source. */
  isDragging: boolean
}

const DESTINATION_ICON_SIZE = 16

function destinationIcon(scope: MemoryScope) {
  switch (scope) {
    case 'global':
      return <GlobeIcon size={DESTINATION_ICON_SIZE} aria-hidden />
    case 'group':
      return <FolderOpenIcon size={DESTINATION_ICON_SIZE} aria-hidden />
    case 'connection':
      return <DatabaseIcon size={DESTINATION_ICON_SIZE} aria-hidden />
  }
}

export function MemoryRow({
  memory,
  source,
  destinations,
  onRequestDelete,
  onMove,
  onDragStart,
  onDragEnd,
  isDragging,
}: MemoryRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const anchorRef = useRef<HTMLDivElement>(null)
  const moveButtonRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Close the move menu on outside click.
  useEffect(() => {
    if (!menuOpen) return
    function handlePointerDown(event: MouseEvent) {
      if (anchorRef.current && !anchorRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [menuOpen])

  // Move focus to the active option when the menu opens / navigation changes.
  useEffect(() => {
    if (!menuOpen) return
    optionRefs.current[activeIndex]?.focus()
  }, [menuOpen, activeIndex])

  const openMenu = () => {
    if (destinations.length === 0) return
    setActiveIndex(0)
    setMenuOpen(true)
  }

  const closeMenu = (returnFocus: boolean) => {
    setMenuOpen(false)
    if (returnFocus) moveButtonRef.current?.focus()
  }

  const selectDestination = (destination: MoveDestination) => {
    setMenuOpen(false)
    moveButtonRef.current?.focus()
    onMove(memory, destination)
  }

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu(true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((i) => (i + 1) % destinations.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => (i - 1 + destinations.length) % destinations.length)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const destination = destinations[activeIndex]
      if (destination) selectDestination(destination)
    }
  }

  return (
    <div
      className={`${styles.row} ${isDragging ? styles.dragging : ''}`}
      data-testid={`ai-memory-item-${memory.id}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', String(memory.id))
        onDragStart(source)
      }}
      onDragEnd={onDragEnd}
    >
      <span
        className={styles.dragHandle}
        aria-hidden
        data-testid={`ai-memory-drag-${memory.id}`}
      >
        <DotsSixVerticalIcon size={16} weight="bold" />
      </span>
      <div className={styles.content}>
        <div className={styles.text}>{memory.content}</div>
        <div className={styles.date}>{`Saved ${formatFromEpochSeconds(memory.createdAt)}`}</div>
      </div>
      <div className={styles.actions}>
        <div className={styles.moveAnchor} ref={anchorRef}>
          <IconButton
            ref={moveButtonRef}
            size="sm"
            aria-label="Move memory to…"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={destinations.length === 0}
            data-testid={`ai-memory-move-${memory.id}`}
            onClick={() => (menuOpen ? closeMenu(false) : openMenu())}
          >
            <ArrowsOutCardinalIcon size={16} />
          </IconButton>
          {menuOpen && (
            <div
              className={styles.moveMenu}
              role="menu"
              aria-label="Move destinations"
              data-testid={`ai-memory-move-menu-${memory.id}`}
              onKeyDown={handleMenuKeyDown}
            >
              <div className={styles.moveMenuLabel}>Move to…</div>
              {destinations.map((destination, index) => (
                <button
                  type="button"
                  key={destination.key}
                  ref={(el) => {
                    optionRefs.current[index] = el
                  }}
                  role="menuitem"
                  className={`${styles.moveOption} ${index === activeIndex ? styles.active : ''}`}
                  data-testid={`ai-memory-move-option-${memory.id}-${destination.key}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectDestination(destination)}
                >
                  <span className={styles.moveOptionIcon}>{destinationIcon(destination.scope)}</span>
                  <span className={styles.moveOptionLabel}>{destination.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
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
