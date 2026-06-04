import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  CaretDownIcon,
  CaretRightIcon,
  DatabaseIcon,
  FolderOpenIcon,
  GlobeIcon,
  PlusCircleIcon,
} from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { Textarea } from '../../common/Textarea'
import { MemoryRow, type MemoryDragPayload, type MoveDestination } from './MemoryRow'
import type { AiMemory, MemoryScope } from '../../../lib/ai-memory-commands'
import styles from './MemorySection.module.css'

export interface MemorySectionProps {
  /** Stable identifier used for test ids and drop targeting. */
  sectionKey: string
  scope: MemoryScope
  label: string
  memories: AiMemory[]
  /** Owner ids for this section's scope (used for add + drop payload). */
  connectionId?: string
  groupId?: string
  /** Render as a nested connection sub-section (tier 1). */
  nested?: boolean
  /** Render a collapsible header (group sections). */
  collapsible?: boolean
  /** Valid move destinations excluding this section's own owner. */
  destinations: MoveDestination[]
  onRequestDelete: (memory: AiMemory) => void
  onMove: (memory: AiMemory, destination: MoveDestination) => void
  onAdd: (content: string) => Promise<void>
  /** Drag/drop wiring (shared across all sections). */
  activeDrag: MemoryDragPayload | null
  onDragStart: (payload: MemoryDragPayload) => void
  onDragEnd: () => void
  onDrop: (
    target: { scope: MemoryScope; connectionId?: string; groupId?: string },
    payload: MemoryDragPayload
  ) => void
  /** Nested connection sub-sections rendered below this section's own content. */
  children?: ReactNode
}

const HEADER_ICON_SIZE = 16

function scopeIcon(scope: MemoryScope) {
  switch (scope) {
    case 'global':
      return <GlobeIcon size={HEADER_ICON_SIZE} aria-hidden />
    case 'group':
      return <FolderOpenIcon size={HEADER_ICON_SIZE} aria-hidden />
    case 'connection':
      return <DatabaseIcon size={HEADER_ICON_SIZE} aria-hidden />
  }
}

function isDropAccepted(
  scope: MemoryScope,
  connectionId: string | undefined,
  groupId: string | undefined,
  payload: MemoryDragPayload | null
): boolean {
  if (!payload) return false
  // Reject dropping onto the memory's current owner (no-op move).
  if (payload.fromScope === scope) {
    if (scope === 'global') return false
    if (scope === 'connection') return (payload.fromConnectionId ?? null) !== (connectionId ?? null)
    if (scope === 'group') return (payload.fromGroupId ?? null) !== (groupId ?? null)
  }
  return true
}

export function MemorySection({
  sectionKey,
  scope,
  label,
  memories,
  connectionId,
  groupId,
  nested = false,
  collapsible = false,
  destinations,
  onRequestDelete,
  onMove,
  onAdd,
  activeDrag,
  onDragStart,
  onDragEnd,
  onDrop,
  children,
}: MemorySectionProps) {
  const [collapsed, setCollapsed] = useState(() => collapsible && memories.length > 5)
  const [addOpen, setAddOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const addTriggerRef = useRef<HTMLButtonElement>(null)
  const formId = useId()

  useEffect(() => {
    if (addOpen) textareaRef.current?.focus()
  }, [addOpen])

  // Clear any lingering drop highlight once the drag ends (dragleave does not
  // fire when the cursor moves into a nested child that stops propagation).
  useEffect(() => {
    if (!activeDrag && isDragOver) setIsDragOver(false)
  }, [activeDrag, isDragOver])

  const closeAdd = (returnFocus: boolean) => {
    setAddOpen(false)
    setDraft('')
    if (returnFocus) addTriggerRef.current?.focus()
  }

  const handleSave = async () => {
    const content = draft.trim()
    if (!content || saving) return
    setSaving(true)
    try {
      await onAdd(content)
      closeAdd(true)
    } finally {
      setSaving(false)
    }
  }

  const dropAccepted = isDropAccepted(scope, connectionId, groupId, activeDrag)

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)
    if (!activeDrag || !dropAccepted) return
    onDrop({ scope, connectionId, groupId }, activeDrag)
  }

  return (
    <div
      className={`${styles.section} ${nested ? styles.nested : ''} ${
        isDragOver && dropAccepted ? styles.dropTarget : ''
      }`}
      data-testid={`ai-memory-section-${sectionKey}`}
      onDragOver={(event) => {
        // Only act while a memory drag is in progress. Calling preventDefault on
        // dragover is what tells the browser this element is a valid drop target;
        // without it no `drop` event fires at all.
        if (!activeDrag) return
        // Stop propagation so a nested connection sub-section claims the hover
        // instead of also lighting up its parent group section.
        event.stopPropagation()
        event.preventDefault()
        event.dataTransfer.dropEffect = dropAccepted ? 'move' : 'none'
        if (dropAccepted) {
          if (!isDragOver) setIsDragOver(true)
        } else if (isDragOver) {
          setIsDragOver(false)
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragOver(false)
      }}
      onDrop={handleDrop}
    >
      {collapsible ? (
        <button
          type="button"
          className={`${styles.header} ${styles.headerButton} ${nested ? styles.headerNested : ''}`}
          aria-expanded={!collapsed}
          data-testid={`ai-memory-section-toggle-${sectionKey}`}
          onClick={() => setCollapsed((c) => !c)}
        >
          <span className={styles.chevron}>
            {collapsed ? <CaretRightIcon size={14} /> : <CaretDownIcon size={14} />}
          </span>
          <span className={styles.headerIcon}>{scopeIcon(scope)}</span>
          <span className={styles.headerLabel}>{label}</span>
          <span className={styles.countBadge}>
            {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
          </span>
        </button>
      ) : (
        <div className={`${styles.header} ${nested ? styles.headerNested : ''}`}>
          <span className={styles.headerIcon}>{scopeIcon(scope)}</span>
          <span className={styles.headerLabel}>{label}</span>
          <span className={styles.countBadge}>
            {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
          </span>
        </div>
      )}

      {!collapsed && (
        <div className={styles.body}>
          {memories.length === 0 ? (
            <div className={styles.emptyState} data-testid={`ai-memory-empty-${sectionKey}`}>
              No memories
            </div>
          ) : (
            memories.map((memory) => (
              <MemoryRow
                key={`${memory.scope}-${memory.id}`}
                memory={memory}
                source={{
                  memoryId: memory.id,
                  fromScope: scope,
                  fromConnectionId: connectionId ?? null,
                  fromGroupId: groupId ?? null,
                }}
                destinations={destinations}
                onRequestDelete={onRequestDelete}
                onMove={onMove}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                isDragging={activeDrag?.memoryId === memory.id && activeDrag.fromScope === scope}
              />
            ))
          )}

          {addOpen ? (
            <div className={styles.addForm} id={formId}>
              <Textarea
                ref={textareaRef}
                className={styles.addTextarea}
                rows={2}
                value={draft}
                placeholder="Write a note for the AI to remember…"
                data-testid={`ai-memory-add-textarea-${sectionKey}`}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    closeAdd(true)
                  }
                }}
              />
              <div className={styles.addActions}>
                <Button
                  variant="secondary"
                  data-testid={`ai-memory-add-cancel-${sectionKey}`}
                  onClick={() => closeAdd(true)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={saving || draft.trim().length === 0}
                  data-testid={`ai-memory-add-save-${sectionKey}`}
                  onClick={() => void handleSave()}
                >
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <Button
              ref={addTriggerRef}
              variant="ghost"
              className={styles.addTrigger}
              aria-expanded={false}
              aria-controls={formId}
              data-testid={`ai-memory-add-trigger-${sectionKey}`}
              onClick={() => setAddOpen(true)}
            >
              <PlusCircleIcon size={14} />
              Add memory
            </Button>
          )}

          {children}
        </div>
      )}
    </div>
  )
}
