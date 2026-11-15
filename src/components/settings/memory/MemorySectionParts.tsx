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
import { joinClassNames } from '../../../lib/class-names'
import { SHIMMER_BLOCK_CONTROL } from '../../../lib/class-names-skeleton'
import { SETTINGS_MEMORY_PANEL } from '../../../lib/class-names-settings'
import { FOCUS_RING } from '../../../lib/focus-ring'
import type { MemoryOwner } from './memory-section-model'
import type { RefObject } from 'react'
import type { MemoryAddForm } from './use-memory-add-form'

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

interface ScopeTone {
  header: string
  hover: string
  label: string
  icon: string
}

const MUTED_ICON = 'text-light-on-surface-variant dark:text-dark-on-surface-variant'

const SCOPE_TONES: Record<MemoryScope, ScopeTone> = {
  global: {
    header: 'bg-light-fill-accent-tint dark:bg-dark-fill-accent-tint',
    hover: 'hover:bg-light-fill-subtle-hover dark:hover:bg-dark-fill-subtle-hover',
    label: 'font-semibold',
    icon: 'text-light-primary dark:text-dark-primary',
  },
  group: {
    header: 'bg-light-surface-container-high dark:bg-dark-surface-container-high',
    hover: 'hover:bg-light-surface-container-high dark:hover:bg-dark-surface-container-high',
    label: 'font-semibold',
    icon: MUTED_ICON,
  },
  connection: {
    header: 'bg-light-surface-container dark:bg-dark-surface-container',
    hover: 'hover:bg-light-surface-container-high dark:hover:bg-dark-surface-container-high',
    label: 'font-regular',
    icon: MUTED_ICON,
  },
}

type HeaderEmphasis = 'standard' | 'subdued'

const HEADER_EMPHASIS_CLASSES: Record<HeaderEmphasis, string> = {
  standard: 'text-light-on-surface dark:text-dark-on-surface',
  subdued: 'text-light-on-surface-variant dark:text-dark-on-surface-variant',
}

function emphasisOf(subdued: boolean): HeaderEmphasis {
  if (subdued) return 'subdued'
  return 'standard'
}

function memoryCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'memory' : 'memories'}`
}

interface MemorySectionHeaderContentProps {
  scope: MemoryScope
  label: string
  memoryCount: number
}

interface MemorySectionHeaderProps {
  sectionKey: string
  scope: MemoryScope
  label: string
  memoryCount: number
  subdued: boolean
  collapse: { collapsible: boolean; collapsed: boolean; onToggle: () => void }
}

function headerClassName(scope: MemoryScope, subdued: boolean): string {
  return joinClassNames([
    'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-size-caption',
    SCOPE_TONES[scope].header,
    HEADER_EMPHASIS_CLASSES[emphasisOf(subdued)],
  ])
}

function collapsibleHeaderClassName(scope: MemoryScope, subdued: boolean): string {
  return joinClassNames([
    headerClassName(scope, subdued),
    'cursor-pointer',
    FOCUS_RING,
    SCOPE_TONES[scope].hover,
  ])
}

function HeaderContent({ scope, label, memoryCount }: MemorySectionHeaderContentProps) {
  const tone = SCOPE_TONES[scope]
  return (
    <>
      <span className={joinClassNames(['flex shrink-0 items-center', tone.icon])}>
        {scopeIcon(scope)}
      </span>
      <span
        className={joinClassNames([
          'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap',
          tone.label,
        ])}
      >
        {label}
      </span>
      <span className="shrink-0 rounded-control border border-light-outline-variant bg-light-surface px-1.5 py-px text-size-caption text-light-on-surface-variant dark:border-dark-outline-variant dark:bg-dark-surface dark:text-dark-on-surface-variant">
        {memoryCountLabel(memoryCount)}
      </span>
    </>
  )
}

export function MemorySectionHeader({
  sectionKey,
  scope,
  label,
  memoryCount,
  subdued,
  collapse,
}: MemorySectionHeaderProps) {
  const headerContent = <HeaderContent scope={scope} label={label} memoryCount={memoryCount} />
  if (!collapse.collapsible) {
    return <div className={headerClassName(scope, subdued)}>{headerContent}</div>
  }
  return (
    <Button
      variant="bare"
      className={collapsibleHeaderClassName(scope, subdued)}
      aria-expanded={!collapse.collapsed}
      data-testid={`ai-memory-section-toggle-${sectionKey}`}
      onClick={collapse.onToggle}
    >
      <span className="flex shrink-0 items-center text-light-on-surface-variant dark:text-dark-on-surface-variant">
        {collapse.collapsed ? <CaretRightIcon size={14} /> : <CaretDownIcon size={14} />}
      </span>
      {headerContent}
    </Button>
  )
}

export function MemoryDropSkeleton({ sectionKey }: { sectionKey: string }) {
  return (
    <div
      className="pointer-events-none my-0.5 flex items-start gap-2 rounded-control border border-dashed border-light-primary bg-light-fill-accent-tint px-2 py-1.5 dark:border-dark-primary dark:bg-dark-fill-accent-tint"
      data-testid={`ai-memory-drop-skeleton-${sectionKey}`}
    >
      <div className={joinClassNames([SHIMMER_BLOCK_CONTROL, 'mt-px size-4 shrink-0'])} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
        <div className={joinClassNames([SHIMMER_BLOCK_CONTROL, 'h-2.5 w-7/10'])} />
        <div className={joinClassNames([SHIMMER_BLOCK_CONTROL, 'h-2 w-3/10'])} />
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
      <div
        className="px-2 py-1 text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant"
        data-testid={`ai-memory-empty-${sectionKey}`}
      >
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
    <div className={joinClassNames(['m-1 p-3.5', SETTINGS_MEMORY_PANEL])} id={formId}>
      <Textarea
        ref={textareaRef}
        variant="verticalResize"
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
      <div className="mt-2 flex justify-end gap-2">
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
      variant="bare"
      className={joinClassNames([
        'my-0.5 ml-1 inline-flex h-control-sm cursor-default items-center justify-center gap-1.5 rounded-control border border-transparent bg-transparent px-1.5 py-1 font-body text-size-caption leading-5 font-regular whitespace-nowrap text-light-on-surface-variant italic opacity-85 hover:bg-light-fill-subtle-hover hover:text-light-on-surface hover:opacity-100 active:bg-light-fill-subtle-pressed dark:text-dark-on-surface-variant dark:hover:bg-dark-fill-subtle-hover dark:hover:text-dark-on-surface dark:active:bg-dark-fill-subtle-pressed',
        FOCUS_RING,
      ])}
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
