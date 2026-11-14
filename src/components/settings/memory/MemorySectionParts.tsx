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
import { MemoryRow, type MemoryDragPayload } from './MemoryRow'
import type { AiMemory, MemoryScope } from '../../../lib/ai-memory-commands'
import { joinClassNames, type MemoryOwner } from './memory-section-model'
import type { RefObject } from 'react'
import type { MemoryAddForm } from './use-memory-add-form'
import styles from './MemorySection.module.css'

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

const SCOPE_TONE_CLASS: Record<MemoryScope, string> = {
  global: styles.toneGlobal,
  group: styles.toneGroup,
  connection: styles.toneConnection,
}

function memoryCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'memory' : 'memories'}`
}

interface MemorySectionHeaderProps {
  sectionKey: string
  scope: MemoryScope
  label: string
  memoryCount: number
  subdued: boolean
  collapse: { collapsible: boolean; collapsed: boolean; onToggle: () => void }
}

export function MemorySectionHeader({
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

export function MemoryDropSkeleton({ sectionKey }: { sectionKey: string }) {
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

export interface MemoryRowHandlers {
  onRequestDelete: (memory: AiMemory) => void
  onDragStart: (payload: MemoryDragPayload) => void
  onDragEnd: () => void
}

interface MemoryListProps {
  sectionKey: string
  memories: AiMemory[]
  owner: MemoryOwner
  activeDrag: MemoryDragPayload | null
  rowHandlers: MemoryRowHandlers
}

function isDraggingMemory(
  activeDrag: MemoryDragPayload | null,
  memory: AiMemory,
  scope: MemoryScope
): boolean {
  return activeDrag?.memoryId === memory.id && activeDrag.fromScope === scope
}

export function MemoryList({
  sectionKey,
  memories,
  owner,
  activeDrag,
  rowHandlers,
}: MemoryListProps) {
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

interface MemoryAddAreaProps {
  sectionKey: string
  formId: string
  addForm: MemoryAddForm
  textareaRef: RefObject<HTMLTextAreaElement | null>
  addTriggerRef: RefObject<HTMLButtonElement | null>
}

function MemoryAddFormFields({ sectionKey, formId, addForm, textareaRef }: MemoryAddAreaProps) {
  return (
    <div className={styles.addForm} id={formId}>
      <Textarea
        ref={textareaRef}
        className={styles.addTextarea}
        rows={2}
        value={addForm.draft}
        placeholder="Write a note for the AI to remember…"
        data-testid={`ai-memory-add-textarea-${sectionKey}`}
        onChange={(event) => addForm.setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          addForm.closeAdd(true)
        }}
      />
      <div className={styles.addActions}>
        <Button
          variant="accent"
          disabled={addForm.isSaveDisabled}
          data-testid={`ai-memory-add-save-${sectionKey}`}
          onClick={() => void addForm.handleSave()}
        >
          Save
        </Button>
        <Button
          data-testid={`ai-memory-add-cancel-${sectionKey}`}
          onClick={() => addForm.closeAdd(true)}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function MemoryAddArea(props: MemoryAddAreaProps) {
  const { sectionKey, formId, addForm, addTriggerRef } = props
  if (addForm.addOpen) return <MemoryAddFormFields {...props} />
  return (
    <Button
      ref={addTriggerRef}
      variant="subtle"
      size="sm"
      className={styles.addTrigger}
      aria-expanded={false}
      aria-controls={formId}
      data-testid={`ai-memory-add-trigger-${sectionKey}`}
      onClick={addForm.openAdd}
    >
      <PlusCircleIcon size={14} />
      Add memory
    </Button>
  )
}
