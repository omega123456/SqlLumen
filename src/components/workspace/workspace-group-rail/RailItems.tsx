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
import { useIsTabDirty } from './use-rail-navigation'
import {
  formatTabCount,
  pinnedKey,
  railItemAccessibility,
  type RailEntry,
  type RailKey,
  type RailTooltipState,
} from './group-rail-model'
import styles from '../WorkspaceGroupRail.module.css'

const RAIL_ICON_SIZE = 18

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
      className={styles.dirty}
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
      className={styles.item}
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
      <span className={styles.iconWrap}>
        <IconComponent
          size={RAIL_ICON_SIZE}
          weight="regular"
          aria-hidden={true}
          data-testid={testId}
          className={styles.icon}
        />
        {isDirty ? <DirtyDot entryKey={entry.key} /> : null}
      </span>
      <span className={styles.count}>{count}</span>
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
      className={`${styles.item} ${styles.pinnedItem}`}
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
        className={styles.icon}
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
      className={styles.tooltip}
      role="tooltip"
      style={{ top: tooltip.top }}
      data-testid="workspace-group-rail-tooltip"
    >
      {group ? (
        <>
          {WORKSPACE_TAB_STACK_META[group.key].label}
          <span className={styles.tooltipCount}>{formatTabCount(group.tabs.length)}</span>
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
    <div className={styles.pinnedSection} data-testid="workspace-group-rail-pinned">
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
