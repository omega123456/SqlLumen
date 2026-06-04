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
import { MemoryRow, MEMORY_DRAG_MIME_TYPE, type MemoryDragPayload } from './MemoryRow'
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
  /** Indent this section one tier (margin + tree line) relative to its container. */
  nested?: boolean
  /** De-emphasise the header (lighter weight + variant color) — used for connection sub-sections. */
  subdued?: boolean
  /** Render a collapsible header (group sections). */
  collapsible?: boolean
  onRequestDelete: (memory: AiMemory) => void
  onAdd: (content: string) => Promise<void>
  /** Drag/drop wiring (shared across all sections). */
  activeDrag: MemoryDragPayload | null
  getActiveDrag: () => MemoryDragPayload | null
  /** Section key currently hovered during a drag (only one section highlights at a time). */
  hoverKey: string | null
  /** Report this section as the drop-hover target (or null to clear). */
  onHover: (key: string | null) => void
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

function parseDragPayload(dataTransfer: DataTransfer): MemoryDragPayload | null {
  try {
    const raw = dataTransfer.getData(MEMORY_DRAG_MIME_TYPE)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<MemoryDragPayload>
    if (
      typeof parsed.memoryId !== 'number' ||
      (parsed.fromScope !== 'global' &&
        parsed.fromScope !== 'group' &&
        parsed.fromScope !== 'connection')
    ) {
      return null
    }
    return {
      memoryId: parsed.memoryId,
      fromScope: parsed.fromScope,
      fromConnectionId:
        typeof parsed.fromConnectionId === 'string' || parsed.fromConnectionId === null
          ? parsed.fromConnectionId
          : undefined,
      fromGroupId:
        typeof parsed.fromGroupId === 'string' || parsed.fromGroupId === null
          ? parsed.fromGroupId
          : undefined,
    }
  } catch {
    return null
  }
}

function hasMemoryDragType(dataTransfer: DataTransfer): boolean {
  for (let i = 0; i < dataTransfer.types.length; i += 1) {
    if (dataTransfer.types[i] === MEMORY_DRAG_MIME_TYPE) return true
  }
  return false
}

export function MemorySection({
  sectionKey,
  scope,
  label,
  memories,
  connectionId,
  groupId,
  nested = false,
  subdued = false,
  collapsible = false,
  onRequestDelete,
  onAdd,
  activeDrag,
  getActiveDrag,
  hoverKey,
  onHover,
  onDragStart,
  onDragEnd,
  onDrop,
  children,
}: MemorySectionProps) {
  const [collapsed, setCollapsed] = useState(() => collapsible && memories.length > 5)
  const [addOpen, setAddOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const addTriggerRef = useRef<HTMLButtonElement>(null)
  const formId = useId()

  // Only the innermost hovered section highlights. Because a nested
  // connection's `dragover` stops propagation and updates the shared hover key,
  // any ancestor section it lives in automatically un-highlights — fixing the
  // "skeleton stuck in every section I dragged through" bug.
  const isDragOver = hoverKey === sectionKey

  const toneClass =
    scope === 'global'
      ? styles.toneGlobal
      : scope === 'group'
        ? styles.toneGroup
        : styles.toneConnection

  useEffect(() => {
    if (addOpen) textareaRef.current?.focus()
  }, [addOpen])

  const resolveDragPayload = (dataTransfer: DataTransfer): MemoryDragPayload | null =>
    activeDrag ?? getActiveDrag() ?? parseDragPayload(dataTransfer)

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

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    onHover(null)
    const payload = resolveDragPayload(event.dataTransfer)
    if (!payload || !isDropAccepted(scope, connectionId, groupId, payload)) return
    onDrop({ scope, connectionId, groupId }, payload)
  }

  return (
    <div
      className={`${styles.section} ${nested ? styles.nested : ''} ${
        isDragOver ? styles.dropTarget : ''
      }`}
      data-testid={`ai-memory-section-${sectionKey}`}
      onDragOver={(event) => {
        const payload = resolveDragPayload(event.dataTransfer)
        const isMemoryDrag = payload !== null || hasMemoryDragType(event.dataTransfer)
        // Calling preventDefault on dragover is what tells the browser this
        // element is a valid drop target; without it no `drop` event fires.
        if (!isMemoryDrag) return
        // Stop propagation so a nested connection sub-section claims the hover
        // instead of also lighting up its parent group section.
        event.stopPropagation()
        event.preventDefault()
        const dropAccepted = payload
          ? isDropAccepted(scope, connectionId, groupId, payload)
          : true
        event.dataTransfer.dropEffect = dropAccepted ? 'move' : 'none'
        if (dropAccepted) {
          if (!isDragOver) onHover(sectionKey)
        } else if (isDragOver) {
          onHover(null)
        }
      }}
      onDragLeave={(event) => {
        // Only clear when the cursor truly leaves this section (not when moving
        // into one of its own children). A move into a sibling/parent section is
        // handled by that section's `dragover` updating the shared hover key.
        if (isDragOver && !event.currentTarget.contains(event.relatedTarget as Node)) onHover(null)
      }}
      onDrop={handleDrop}
    >
      {collapsible ? (
        <button
          type="button"
          className={`${styles.header} ${styles.headerButton} ${toneClass} ${
            subdued ? styles.headerSubdued : ''
          }`}
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
        <div className={`${styles.header} ${toneClass} ${subdued ? styles.headerSubdued : ''}`}>
          <span className={styles.headerIcon}>{scopeIcon(scope)}</span>
          <span className={styles.headerLabel}>{label}</span>
          <span className={styles.countBadge}>
            {memories.length} {memories.length === 1 ? 'memory' : 'memories'}
          </span>
        </div>
      )}

      {!collapsed && (
        <div className={styles.body}>
          {isDragOver && (
            <div className={styles.skeletonRow} data-testid={`ai-memory-drop-skeleton-${sectionKey}`}>
              <div className={`shimmerBlock ${styles.skeletonHandle}`} />
              <div className={styles.skeletonContent}>
                <div className={`shimmerBlock ${styles.skeletonLineText}`} />
                <div className={`shimmerBlock ${styles.skeletonLineDate}`} />
              </div>
            </div>
          )}
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
                onRequestDelete={onRequestDelete}
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
