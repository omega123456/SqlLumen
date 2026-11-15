import type { KeyboardEvent } from 'react'
import type { WorkspaceTab } from '../../../types/schema'
import {
  WORKSPACE_TAB_STACK_META,
  type WorkspaceTabStackGroup,
  type WorkspaceTabStackKey,
} from '../../../lib/workspace-tab-stacks'
import {
  getWorkspaceStackIconDescriptor,
  getWorkspaceTabIconDescriptor,
} from '../workspace-tab-icons'
import { Button } from '../../common/Button'
import { joinClassNames } from '../../../lib/class-names'
import { FOCUS_RING } from '../../../lib/focus-ring'
import { useIsTabDirty } from './use-rail-navigation'
import {
  formatTabCount,
  pinnedKey,
  railItemAccessibility,
  type RailEntry,
  type RailItemPhase,
  type RailKey,
  type RailTooltipState,
} from './group-rail-model'

const RAIL_ICON_SIZE = 18

type RailItemKind = 'group' | 'pinned'
type RailItemSelection = 'idle' | 'selected'

const ITEM_FRAME_CLASS_NAMES: Record<RailItemKind, string> = {
  group: 'h-11',
  pinned: 'h-9',
}

const ITEM_SELECTION_CLASS_NAMES: Record<RailItemSelection, string> = {
  idle: 'text-light-on-surface-variant hover:text-light-on-surface dark:text-dark-on-surface-variant dark:hover:text-dark-on-surface',
  selected: 'text-light-on-surface dark:text-dark-on-surface',
}

const ITEM_COUNT_CLASS_NAMES: Record<RailItemSelection, string> = {
  idle: '',
  selected: 'font-semibold',
}

const PINNED_ICON_CLASS_NAMES: Record<RailItemSelection, string> = {
  idle: 'shrink-0 text-light-on-surface-variant group-hover/rail-item:text-light-on-surface group-active/rail-item:opacity-80 dark:text-dark-on-surface-variant dark:group-hover/rail-item:text-dark-on-surface',
  selected:
    'shrink-0 text-light-on-surface group-active/rail-item:opacity-80 dark:text-dark-on-surface',
}

const ITEM_PHASE_CLASS_NAMES: Record<RailItemPhase, string> = {
  idle: '',
  entering:
    'motion-safe:animate-rail-item-enter motion-safe:window-blurred:animate-rail-item-enter-paused',
  leaving:
    'pointer-events-none motion-safe:animate-rail-item-leave motion-safe:window-blurred:animate-rail-item-leave-paused motion-reduce:hidden',
}

function selectionOf(isSelected: boolean): RailItemSelection {
  if (isSelected) return 'selected'
  return 'idle'
}

interface RailItemClassOptions {
  kind: RailItemKind
  selection: RailItemSelection
  phase: RailItemPhase
}

function railItemClassName({ kind, selection, phase }: RailItemClassOptions): string {
  return joinClassNames([
    'group/rail-item relative flex w-9 flex-none flex-col items-center justify-center gap-0.5 rounded-control p-0 text-start text-caption cursor-default tabular-nums',
    ITEM_FRAME_CLASS_NAMES[kind],
    ITEM_SELECTION_CLASS_NAMES[selection],
    'hover:bg-light-fill-subtle-hover active:bg-light-fill-subtle-pressed dark:hover:bg-dark-fill-subtle-hover dark:active:bg-dark-fill-subtle-pressed',
    FOCUS_RING,
    ITEM_PHASE_CLASS_NAMES[phase],
  ])
}

export interface RailItemHandlers {
  isTabStop: (key: RailKey) => boolean
  setItemRef: (key: RailKey) => (node: HTMLButtonElement | null) => void
  onClick: (key: RailKey) => void
  onMouseEnter: (key: RailKey) => void
  onMouseLeave: () => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, key: RailKey) => void
}

function DirtyDot({ entryKey }: { entryKey: RailEntry['key'] }) {
  return (
    <span
      className="absolute -top-0.5 -right-1 size-1.5 rounded-round bg-light-primary dark:bg-dark-primary"
      aria-hidden="true"
      data-testid={`workspace-group-rail-dirty-${entryKey}`}
    />
  )
}

interface RailGroupItemProps {
  entry: RailEntry
  tabs: WorkspaceTab[]
  isSelected: boolean
  isDirty: boolean
  handlers: RailItemHandlers
}

function RailGroupItem({ entry, tabs, isSelected, isDirty, handlers }: RailGroupItemProps) {
  const live = entry.phase !== 'leaving'
  const selected = live && isSelected
  const count = tabs.length
  const label = WORKSPACE_TAB_STACK_META[entry.key].label
  const { IconComponent, testId } = getWorkspaceStackIconDescriptor(entry.key)
  return (
    <Button
      variant="bare"
      ref={handlers.setItemRef(entry.key)}
      {...railItemAccessibility(live, selected)}
      className={railItemClassName({
        kind: 'group',
        selection: selectionOf(selected),
        phase: entry.phase,
      })}
      aria-label={`${label}, ${formatTabCount(count)}`}
      disabled={!live}
      tabIndex={handlers.isTabStop(entry.key) ? 0 : -1}
      data-phase={entry.phase === 'idle' ? undefined : entry.phase}
      data-selected={selected || undefined}
      data-testid={`workspace-group-rail-item-${entry.key}`}
      onClick={() => handlers.onClick(entry.key)}
      onMouseEnter={() => handlers.onMouseEnter(entry.key)}
      onMouseLeave={handlers.onMouseLeave}
      onKeyDown={(event) => handlers.onKeyDown(event, entry.key)}
    >
      <span className="relative flex">
        <IconComponent
          size={RAIL_ICON_SIZE}
          weight="regular"
          aria-hidden={true}
          data-testid={testId}
          className="shrink-0 text-light-on-surface-variant group-active/rail-item:opacity-80 dark:text-dark-on-surface-variant"
        />
        {isDirty ? <DirtyDot entryKey={entry.key} /> : null}
      </span>
      <span className={ITEM_COUNT_CLASS_NAMES[selectionOf(selected)]}>{count}</span>
    </Button>
  )
}

interface RailPinnedItemProps {
  tab: WorkspaceTab
  railKey: RailKey
  isSelected: boolean
  handlers: RailItemHandlers
}

function RailPinnedItem({ tab, railKey, isSelected, handlers }: RailPinnedItemProps) {
  const { IconComponent, testId } = getWorkspaceTabIconDescriptor(tab)
  return (
    <Button
      variant="bare"
      ref={handlers.setItemRef(railKey)}
      role="tab"
      className={railItemClassName({
        kind: 'pinned',
        selection: selectionOf(isSelected),
        phase: 'idle',
      })}
      aria-selected={isSelected}
      aria-label={tab.label}
      tabIndex={handlers.isTabStop(railKey) ? 0 : -1}
      data-selected={isSelected || undefined}
      data-testid={`workspace-pinned-tab-${tab.type}`}
      onClick={() => handlers.onClick(railKey)}
      onMouseEnter={() => handlers.onMouseEnter(railKey)}
      onMouseLeave={handlers.onMouseLeave}
      onKeyDown={(event) => handlers.onKeyDown(event, railKey)}
    >
      <IconComponent
        size={RAIL_ICON_SIZE}
        weight="regular"
        aria-hidden={true}
        data-testid={testId}
        className={PINNED_ICON_CLASS_NAMES[selectionOf(isSelected)]}
      />
    </Button>
  )
}

interface RailTooltipProps {
  tooltip: RailTooltipState | null
  group: WorkspaceTabStackGroup | undefined
  pinnedTab: WorkspaceTab | undefined
}

export function RailTooltip({ tooltip, group, pinnedTab }: RailTooltipProps) {
  if (!tooltip) return null
  const tooltipSubject = group ?? pinnedTab
  if (!tooltipSubject) return null
  return (
    <div
      className="pointer-events-none absolute left-rail-tooltip z-20 rounded-control border border-light-stroke-flyout bg-light-surface-container-high px-2 py-1.25 text-caption whitespace-nowrap text-light-on-surface shadow-light-flyout motion-safe:animate-rail-tooltip-in motion-safe:window-blurred:animate-rail-tooltip-in-paused dark:border-dark-stroke-flyout dark:bg-dark-surface-container-high dark:text-dark-on-surface dark:shadow-dark-flyout"
      role="tooltip"
      style={{ top: tooltip.top }}
      data-testid="workspace-group-rail-tooltip"
    >
      {group ? (
        <>
          {WORKSPACE_TAB_STACK_META[group.key].label}
          <span className="ml-1.5 text-light-on-surface-variant dark:text-dark-on-surface-variant">
            {formatTabCount(group.tabs.length)}
          </span>
        </>
      ) : (
        pinnedTab?.label
      )}
    </div>
  )
}

interface RailPinnedSectionProps {
  pinnedTabs: WorkspaceTab[]
  selectedKey: RailKey | null
  handlers: RailItemHandlers
}

export function RailPinnedSection({ pinnedTabs, selectedKey, handlers }: RailPinnedSectionProps) {
  if (pinnedTabs.length === 0) return null
  return (
    <div
      className="mt-auto flex flex-col items-center gap-1 pb-1.5 before:mb-1 before:h-px before:w-5 before:flex-none before:bg-light-stroke-divider dark:before:bg-dark-stroke-divider"
      data-testid="workspace-group-rail-pinned"
    >
      {pinnedTabs.map((tab) => (
        <RailPinnedItem
          key={tab.id}
          tab={tab}
          railKey={pinnedKey(tab)}
          isSelected={pinnedKey(tab) === selectedKey}
          handlers={handlers}
        />
      ))}
    </div>
  )
}

interface RailGroupItemsProps {
  entries: RailEntry[]
  groupByKey: Map<WorkspaceTabStackKey, WorkspaceTabStackGroup>
  selectedKey: RailKey | null
  handlers: RailItemHandlers
}

export function RailGroupItems({
  entries,
  groupByKey,
  selectedKey,
  handlers,
}: RailGroupItemsProps) {
  const isTabDirty = useIsTabDirty()
  return (
    <>
      {entries.map((entry) => {
        const tabs = groupByKey.get(entry.key)?.tabs ?? entry.tabs
        return (
          <RailGroupItem
            key={entry.key}
            entry={entry}
            tabs={tabs}
            isSelected={entry.key === selectedKey}
            isDirty={tabs.some(isTabDirty)}
            handlers={handlers}
          />
        )
      })}
    </>
  )
}
