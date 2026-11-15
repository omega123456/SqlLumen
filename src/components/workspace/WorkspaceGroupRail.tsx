import type { WorkspaceTab } from '../../types/schema'
import type { WorkspaceTabStackGroup, WorkspaceTabStackKey } from '../../lib/workspace-tab-stacks'
import {
  pinnedKey,
  railClassName,
  resolveSelectedRailKey,
  type RailEntry,
  type RailKey,
} from './workspace-group-rail/group-rail-model'
import { RailGroupItems, RailPinnedSection, RailTooltip } from './workspace-group-rail/RailItems'
import { useRailEntries } from './workspace-group-rail/use-rail-entries'
import { useRailMarker, useRailTooltip } from './workspace-group-rail/use-rail-item-layout'
import { buildRailItemHandlers, useRailItemRefs } from './workspace-group-rail/use-rail-navigation'

export {
  RAIL_ITEM_TRANSITION_MS,
  RAIL_TOOLTIP_DELAY_MS,
} from './workspace-group-rail/group-rail-model'

const NO_PINNED_TABS: WorkspaceTab[] = []

export interface WorkspaceGroupRailProps {
  stackGroups: WorkspaceTabStackGroup[]
  value: WorkspaceTabStackKey | null
  onSelect: (stackKey: WorkspaceTabStackKey) => void
  onFocusMembers?: (stackKey: WorkspaceTabStackKey) => void
  pinnedTabs?: WorkspaceTab[]
  activePinnedTabId?: string | null
  onSelectPinned?: (tabId: string) => void
  className?: string
}

interface RailSelectionInputs {
  entries: RailEntry[]
  stackGroups: WorkspaceTabStackGroup[]
  pinnedTabs: WorkspaceTab[]
  activePinnedTabId: string | null
  value: WorkspaceTabStackKey | null
}

function resolveRailSelection(inputs: RailSelectionInputs) {
  const { entries, pinnedTabs } = inputs
  const liveKeys = entries.filter((entry) => entry.phase !== 'leaving').map((entry) => entry.key)
  const pinnedByKey = new Map(pinnedTabs.map((tab) => [pinnedKey(tab), tab]))
  const navigableKeys: RailKey[] = [...liveKeys, ...pinnedByKey.keys()]
  const selectedKey = resolveSelectedRailKey({
    activePinnedTab: pinnedTabs.find((tab) => tab.id === inputs.activePinnedTabId),
    value: inputs.value,
    liveKeys: liveKeys,
  })
  return {
    groupByKey: new Map(inputs.stackGroups.map((group) => [group.key, group])),
    pinnedByKey: pinnedByKey,
    navigableKeys: navigableKeys,
    selectedKey: selectedKey,
    tabStopKey: selectedKey ?? navigableKeys[0] ?? null,
  }
}

export function WorkspaceGroupRail(props: WorkspaceGroupRailProps) {
  const { stackGroups, value, pinnedTabs = NO_PINNED_TABS, activePinnedTabId = null } = props
  const entries = useRailEntries(stackGroups)
  const selection = resolveRailSelection({
    entries: entries,
    stackGroups: stackGroups,
    pinnedTabs: pinnedTabs,
    activePinnedTabId: activePinnedTabId,
    value: value,
  })
  const { groupByKey, pinnedByKey, selectedKey } = selection
  const { itemRefs, setItemRef } = useRailItemRefs()
  const markerRef = useRailMarker(itemRefs, selectedKey, entries)
  const tooltipControls = useRailTooltip(itemRefs)
  const { tooltip } = tooltipControls
  const handlers = buildRailItemHandlers({
    ...selection,
    tooltip: tooltipControls,
    setItemRef: setItemRef,
    focusItem: (key) => itemRefs.current.get(key)?.focus(),
    onSelect: props.onSelect,
    onFocusMembers: props.onFocusMembers,
    onSelectPinned: props.onSelectPinned,
  })

  return (
    <div
      className={railClassName(props.className)}
      role="tablist"
      aria-orientation="vertical"
      aria-label="Tab groups"
      data-testid="workspace-group-rail"
    >
      <div
        ref={markerRef}
        className="pointer-events-none absolute top-0 left-0 h-6 w-0.5 rounded-marker bg-light-on-surface motion-safe:data-animate:transition-transform motion-safe:data-animate:duration-170 motion-safe:data-animate:ease-rail dark:bg-dark-on-surface"
        hidden={!selectedKey}
        aria-hidden="true"
        data-testid="workspace-group-rail-marker"
      />
      <RailGroupItems
        entries={entries}
        groupByKey={groupByKey}
        selectedKey={selectedKey}
        handlers={handlers}
      />
      <RailPinnedSection pinnedTabs={pinnedTabs} selectedKey={selectedKey} handlers={handlers} />
      <RailTooltip
        tooltip={tooltip}
        group={tooltip ? groupByKey.get(tooltip.key as WorkspaceTabStackKey) : undefined}
        pinnedTab={tooltip ? pinnedByKey.get(tooltip.key) : undefined}
      />
    </div>
  )
}
