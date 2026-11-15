import { useId, useState, type ReactNode } from 'react'
import type { MemoryDragPayload } from './MemoryRow'
import type { AiMemory, MemoryScope } from '../../../lib/ai-memory-commands'
import { joinClassNames } from '../../../lib/class-names'
import { SETTINGS_MEMORY_NEST } from '../../../lib/class-names-settings'
import type { MemoryOwner } from './memory-section-model'
import {
  MemoryAddArea,
  MemoryDropSkeleton,
  MemoryList,
  MemorySectionHeader,
} from './MemorySectionParts'
import { useMemoryAddForm } from './use-memory-add-form'
import { useMemoryDropTarget } from './use-memory-drop-target'

const AUTO_COLLAPSE_MEMORY_COUNT = 5

type SectionNesting = 'root' | 'nested'
type SectionDropState = 'idle' | 'dropTarget'

const NESTING_CLASSES: Record<SectionNesting, string> = {
  root: '',
  nested: SETTINGS_MEMORY_NEST,
}

const DROP_STATE_CLASSES: Record<SectionDropState, string> = {
  idle: '',
  dropTarget: 'rounded-control',
}

function nestingOf(nested: boolean | undefined): SectionNesting {
  if (nested) return 'nested'
  return 'root'
}

function dropStateOf(isDragOver: boolean): SectionDropState {
  if (isDragOver) return 'dropTarget'
  return 'idle'
}

export interface MemorySectionProps {
  sectionKey: string
  scope: MemoryScope
  label: string
  memories: AiMemory[]
  connectionId?: string
  groupId?: string
  nested?: boolean
  subdued?: boolean
  collapsible?: boolean
  onRequestDelete: (memory: AiMemory) => void
  onAdd: (content: string) => Promise<void>
  activeDrag: MemoryDragPayload | null
  getActiveDrag: () => MemoryDragPayload | null
  hoverKey: string | null
  onHover: (key: string | null) => void
  onDragStart: (payload: MemoryDragPayload) => void
  onDragEnd: () => void
  onDrop: (target: MemoryOwner, payload: MemoryDragPayload) => void
  children?: ReactNode
}

function shouldStartCollapsed(collapsible: boolean, memoryCount: number): boolean {
  return collapsible && memoryCount > AUTO_COLLAPSE_MEMORY_COUNT
}

interface MemorySectionBodyProps {
  props: MemorySectionProps
  owner: MemoryOwner
  isDragOver: boolean
}

function MemorySectionBody({ props, owner, isDragOver }: MemorySectionBodyProps) {
  const { sectionKey } = props
  const formId = useId()
  const { form, textareaRef, addTriggerRef } = useMemoryAddForm(props.onAdd)
  return (
    <div className="py-0.5 pr-0 pl-1">
      {isDragOver && <MemoryDropSkeleton sectionKey={sectionKey} />}
      <MemoryList
        sectionKey={sectionKey}
        memories={props.memories}
        owner={owner}
        activeDrag={props.activeDrag}
        rowHandlers={{
          onRequestDelete: props.onRequestDelete,
          onDragStart: props.onDragStart,
          onDragEnd: props.onDragEnd,
        }}
      />
      <MemoryAddArea
        sectionKey={sectionKey}
        formId={formId}
        addForm={form}
        textareaRef={textareaRef}
        addTriggerRef={addTriggerRef}
      />
      {props.children}
    </div>
  )
}

export function MemorySection(props: MemorySectionProps) {
  const { sectionKey, scope, connectionId, groupId, collapsible = false } = props
  const [collapsed, setCollapsed] = useState(() =>
    shouldStartCollapsed(collapsible, props.memories.length)
  )
  const owner: MemoryOwner = { scope: scope, connectionId: connectionId, groupId: groupId }
  const dropTarget = useMemoryDropTarget({ ...props, owner: owner })
  const { isDragOver } = dropTarget

  return (
    <div
      className={joinClassNames([
        'relative py-1 after-memory-section:mt-1',
        NESTING_CLASSES[nestingOf(props.nested)],
        DROP_STATE_CLASSES[dropStateOf(isDragOver)],
      ])}
      data-memory-section
      data-drop-state={dropStateOf(isDragOver)}
      data-testid={`ai-memory-section-${sectionKey}`}
      onDragOver={dropTarget.handleDragOver}
      onDragLeave={dropTarget.handleDragLeave}
      onDrop={dropTarget.handleDrop}
    >
      <MemorySectionHeader
        sectionKey={sectionKey}
        scope={scope}
        label={props.label}
        memoryCount={props.memories.length}
        subdued={props.subdued ?? false}
        collapse={{
          collapsible: collapsible,
          collapsed: collapsed,
          onToggle: () => setCollapsed((isCollapsed) => !isCollapsed),
        }}
      />
      {!collapsed && <MemorySectionBody props={props} owner={owner} isDragOver={isDragOver} />}
    </div>
  )
}
