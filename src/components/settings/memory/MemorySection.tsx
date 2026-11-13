import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  CaretDownIcon,
  CaretRightIcon,
  DatabaseIcon,
  FolderOpenIcon,
  GlobeIcon,
  PlusCircleIcon,
  type Icon,
} from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { Textarea } from '../../common/Textarea'
import { MemoryRow, MEMORY_DRAG_MIME_TYPE, type MemoryDragPayload } from './MemoryRow'
import type { AiMemory, MemoryScope } from '../../../lib/ai-memory-commands'
import { logParseFallback } from '../../../lib/app-log-commands'
import styles from './MemorySection.module.css'
import { isMemoryScope } from '../../../lib/ai-memory-commands'
import { isTargetOutside } from '../../../lib/input-events'

const AUTO_COLLAPSE_MEMORY_COUNT = 5

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

const SCOPE_ICONS: Record<MemoryScope, Icon> = {
  global: GlobeIcon,
  group: FolderOpenIcon,
  connection: DatabaseIcon,
}

function scopeIcon(scope: MemoryScope) {
  const ScopeIcon = SCOPE_ICONS[scope]
  return <ScopeIcon size={HEADER_ICON_SIZE} aria-hidden />
}

interface MemoryDropCandidate {
  scope: MemoryScope
  connectionId: string | undefined
  groupId: string | undefined
  payload: MemoryDragPayload | null
}

function isDropAccepted({ scope, connectionId, groupId, payload }: MemoryDropCandidate): boolean {
  if (!payload) return false
  // Reject dropping onto the memory's current owner (no-op move).
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

function parseDragPayload(dataTransfer: DataTransfer): MemoryDragPayload | null {
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

function hasMemoryDragType(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(MEMORY_DRAG_MIME_TYPE)
}

function shouldStartCollapsed(collapsible: boolean, memoryCount: number): boolean {
  return collapsible && memoryCount > AUTO_COLLAPSE_MEMORY_COUNT
}

const SCOPE_TONE_CLASS: Record<MemoryScope, string> = {
  global: styles.toneGlobal,
  group: styles.toneGroup,
  connection: styles.toneConnection,
}

function memoryCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'memory' : 'memories'}`
}

function joinClassNames(classNames: string[]): string {
  return classNames.filter(Boolean).join(' ')
}

interface MemorySectionHeaderProps {
  sectionKey: string
  scope: MemoryScope
  label: string
  memoryCount: number
  subdued: boolean
  collapse: { collapsible: boolean; collapsed: boolean; onToggle: () => void }
}

function MemorySectionHeader({
  sectionKey,
  scope,
  label,
  memoryCount,
  subdued,
  collapse,
}: MemorySectionHeaderProps) {
  const headerClassNames = [
    styles.header,
    SCOPE_TONE_CLASS[scope],
    subdued ? styles.headerSubdued : '',
  ]
  const headerContent = (
    <>
      <span className={styles.headerIcon}>{scopeIcon(scope)}</span>
      <span className={styles.headerLabel}>{label}</span>
      <span className={styles.countBadge}>{memoryCountLabel(memoryCount)}</span>
    </>
  )
  if (!collapse.collapsible) {
    return <div className={joinClassNames(headerClassNames)}>{headerContent}</div>
  }
  return (
    <Button
      variant="bare"
      className={joinClassNames([...headerClassNames, styles.headerButton])}
      aria-expanded={!collapse.collapsed}
      data-testid={`ai-memory-section-toggle-${sectionKey}`}
      onClick={collapse.onToggle}
    >
      <span className={styles.chevron}>
        {collapse.collapsed ? <CaretRightIcon size={14} /> : <CaretDownIcon size={14} />}
      </span>
      {headerContent}
    </Button>
  )
}

function MemoryDropSkeleton({ sectionKey }: { sectionKey: string }) {
  return (
    <div className={styles.skeletonRow} data-testid={`ai-memory-drop-skeleton-${sectionKey}`}>
      <div className={`shimmerBlock ${styles.skeletonHandle}`} />
      <div className={styles.skeletonContent}>
        <div className={`shimmerBlock ${styles.skeletonLineText}`} />
        <div className={`shimmerBlock ${styles.skeletonLineDate}`} />
      </div>
    </div>
  )
}

interface MemoryListProps {
  sectionKey: string
  memories: AiMemory[]
  owner: { scope: MemoryScope; connectionId?: string; groupId?: string }
  activeDrag: MemoryDragPayload | null
  rowHandlers: Pick<MemorySectionProps, 'onRequestDelete' | 'onDragStart' | 'onDragEnd'>
}

function isDraggingMemory(
  activeDrag: MemoryDragPayload | null,
  memory: AiMemory,
  scope: MemoryScope
): boolean {
  return activeDrag?.memoryId === memory.id && activeDrag.fromScope === scope
}

function MemoryList({ sectionKey, memories, owner, activeDrag, rowHandlers }: MemoryListProps) {
  if (memories.length === 0) {
    return (
      <div className={styles.emptyState} data-testid={`ai-memory-empty-${sectionKey}`}>
        No memories
      </div>
    )
  }
  return (
    <>
      {memories.map((memory) => (
        <MemoryRow
          key={`${memory.scope}-${memory.id}`}
          memory={memory}
          source={{
            memoryId: memory.id,
            fromScope: owner.scope,
            fromConnectionId: owner.connectionId ?? null,
            fromGroupId: owner.groupId ?? null,
          }}
          onRequestDelete={rowHandlers.onRequestDelete}
          onDragStart={rowHandlers.onDragStart}
          onDragEnd={rowHandlers.onDragEnd}
          isDragging={isDraggingMemory(activeDrag, memory, owner.scope)}
        />
      ))}
    </>
  )
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
  const [collapsed, setCollapsed] = useState(() =>
    shouldStartCollapsed(collapsible, memories.length)
  )
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
    if (!content) return
    if (saving) return
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
    if (!payload) return
    if (
      !isDropAccepted({
        scope: scope,
        connectionId: connectionId,
        groupId: groupId,
        payload: payload,
      })
    )
      return
    onDrop({ scope, connectionId, groupId }, payload)
  }

  return (
    <div
      className={joinClassNames([
        styles.section,
        nested ? styles.nested : '',
        isDragOver ? styles.dropTarget : '',
      ])}
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
          ? isDropAccepted({
              scope: scope,
              connectionId: connectionId,
              groupId: groupId,
              payload: payload,
            })
          : true
        event.dataTransfer.dropEffect = dropAccepted ? 'move' : 'none'
        const hoverChanged = dropAccepted !== isDragOver
        if (hoverChanged) onHover(dropAccepted ? sectionKey : null)
      }}
      onDragLeave={(event) => {
        // Only clear when the cursor truly leaves this section (not when moving
        // into one of its own children). A move into a sibling/parent section is
        // handled by that section's `dragover` updating the shared hover key.
        const hasLeftSection =
          isDragOver && isTargetOutside(event.currentTarget, event.relatedTarget)
        if (hasLeftSection) onHover(null)
      }}
      onDrop={handleDrop}
    >
      <MemorySectionHeader
        sectionKey={sectionKey}
        scope={scope}
        label={label}
        memoryCount={memories.length}
        subdued={subdued}
        collapse={{
          collapsible: collapsible,
          collapsed: collapsed,
          onToggle: () => setCollapsed((isCollapsed) => !isCollapsed),
        }}
      />

      {!collapsed && (
        <div className={styles.body}>
          {isDragOver && <MemoryDropSkeleton sectionKey={sectionKey} />}
          <MemoryList
            sectionKey={sectionKey}
            memories={memories}
            owner={{ scope: scope, connectionId: connectionId, groupId: groupId }}
            activeDrag={activeDrag}
            rowHandlers={{
              onRequestDelete: onRequestDelete,
              onDragStart: onDragStart,
              onDragEnd: onDragEnd,
            }}
          />

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
                  variant="accent"
                  disabled={saving || draft.trim().length === 0}
                  data-testid={`ai-memory-add-save-${sectionKey}`}
                  onClick={() => void handleSave()}
                >
                  Save
                </Button>
                <Button
                  data-testid={`ai-memory-add-cancel-${sectionKey}`}
                  onClick={() => closeAdd(true)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              ref={addTriggerRef}
              variant="subtle"
              size="sm"
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
