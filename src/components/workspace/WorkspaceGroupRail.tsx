/**
 * WorkspaceGroupRail — the tab-group switcher at the workspace's left edge.
 *
 * One item per group with open tabs: the group icon over its tab count. The pinned tabs (History,
 * Process list) sit at the bottom of the rail as icon-only items. The selected item gets a neutral
 * marker that slides between items; hovering an item shows its name (and a group's count) in a
 * tooltip. Groups that appear or disappear fade in and out so the rail doesn't jump.
 *
 * Keyboard: the rail is one tab stop (roving tabindex). Arrow Up/Down (and Home/End) select the
 * neighbouring item, groups first, then pinned tabs; Arrow Right moves focus into the shown group's
 * tabs.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { WorkspaceTab } from '../../types/schema'
import {
  WORKSPACE_TAB_STACK_META,
  WORKSPACE_TAB_STACK_ORDER,
  type WorkspaceTabStackGroup,
  type WorkspaceTabStackKey,
} from '../../lib/workspace-tab-stacks'
import { useObjectEditorStore } from '../../stores/object-editor-store'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import {
  getWorkspaceStackIconDescriptor,
  getWorkspaceTabIconDescriptor,
} from './workspace-tab-icons'
import { Button } from '../common/Button'
import styles from './WorkspaceGroupRail.module.css'
import { HALF_DIVISOR } from '../../lib/units'

/** Matches the enter/leave animation length in WorkspaceGroupRail.module.css. */
export const RAIL_ITEM_TRANSITION_MS = 150
/** Hover time before the tooltip shows (proposal prototype). */
export const RAIL_TOOLTIP_DELAY_MS = 450
const MARKER_HEIGHT = 24
const TOOLTIP_HEIGHT = 28

type RailItemPhase = 'idle' | 'entering' | 'leaving'

/** A group key, or `pinned:<tab type>` for a pinned tab. */
type RailKey = WorkspaceTabStackKey | `pinned:${string}`

interface RailEntry {
  key: WorkspaceTabStackKey
  phase: RailItemPhase
  /** Last known tabs, kept so a leaving item can still render while it fades out. */
  tabs: WorkspaceTab[]
}

export interface WorkspaceGroupRailProps {
  stackGroups: WorkspaceTabStackGroup[]
  /** The group whose tabs the strip shows; null when no tab is open. */
  value: WorkspaceTabStackKey | null
  onSelect: (stackKey: WorkspaceTabStackKey) => void
  onFocusMembers?: (stackKey: WorkspaceTabStackKey) => void
  /** History and Process list tabs, shown at the bottom of the rail. */
  pinnedTabs?: WorkspaceTab[]
  /** The selected pinned tab, which takes the selection from the shown group. */
  activePinnedTabId?: string | null
  onSelectPinned?: (tabId: string) => void
  className?: string
}

function formatTabCount(count: number): string {
  return `${count} ${count === 1 ? 'tab' : 'tabs'}`
}

function groupsSignature(groups: WorkspaceTabStackGroup[]): string {
  return groups.map((group) => group.key).join(',')
}

type RailNavigationTarget = (keys: RailKey[], index: number) => RailKey | undefined

const RAIL_NAVIGATION_TARGETS: Record<string, RailNavigationTarget> = {
  ArrowDown: (keys, index) => keys[(index + 1) % keys.length],
  ArrowUp: (keys, index) => keys[(index - 1 + keys.length) % keys.length],
  Home: (keys) => keys[0],
  End: (keys) => keys[keys.length - 1],
}

function enteringPhase(prior: RailEntry | undefined): RailItemPhase {
  if (!prior) return 'entering'
  if (prior.phase === 'leaving') return 'entering'
  return prior.phase
}

function mergedEntry(
  key: WorkspaceTabStackKey,
  group: WorkspaceTabStackGroup | undefined,
  prior: RailEntry | undefined
): RailEntry | null {
  if (group) return { key: key, phase: enteringPhase(prior), tabs: group.tabs }
  if (prior) return { key: key, phase: 'leaving', tabs: prior.tabs }
  return null
}

function pinnedKey(tab: WorkspaceTab): RailKey {
  return `pinned:${tab.type}`
}

interface SelectedRailKeyInputs {
  activePinnedTab: WorkspaceTab | undefined
  value: WorkspaceTabStackKey | null
  liveKeys: WorkspaceTabStackKey[]
}

function resolveSelectedRailKey(inputs: SelectedRailKeyInputs): RailKey | null {
  if (inputs.activePinnedTab) return pinnedKey(inputs.activePinnedTab)
  const selectedValue = inputs.value
  if (!selectedValue) return null
  return inputs.liveKeys.includes(selectedValue) ? selectedValue : null
}

function railClassName(className: string | undefined): string {
  return className ? `${styles.rail} ${className}` : styles.rail
}

function railItemAccessibility(live: boolean, selected: boolean) {
  if (!live) return { role: undefined, 'aria-selected': undefined, 'aria-hidden': true }
  return { role: 'tab', 'aria-selected': selected, 'aria-hidden': undefined }
}

interface RailTooltipProps {
  tooltip: { key: RailKey; top: number } | null
  group: WorkspaceTabStackGroup | undefined
  pinnedTab: WorkspaceTab | undefined
}

function RailTooltip({ tooltip, group, pinnedTab }: RailTooltipProps) {
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

function mergeEntries(previous: RailEntry[], groups: WorkspaceTabStackGroup[]): RailEntry[] {
  const current = new Map(groups.map((group) => [group.key, group]))
  const before = new Map(previous.map((entry) => [entry.key, entry]))
  const next: RailEntry[] = []
  for (const key of WORKSPACE_TAB_STACK_ORDER) {
    const entry = mergedEntry(key, current.get(key), before.get(key))
    if (entry) next.push(entry)
  }
  return next
}

export function WorkspaceGroupRail({
  stackGroups,
  value,
  onSelect,
  onFocusMembers,
  pinnedTabs = [],
  activePinnedTabId = null,
  onSelectPinned,
  className,
}: WorkspaceGroupRailProps) {
  const designerTabs = useTableDesignerStore((state) => state.tabs)
  const objectEditorTabs = useObjectEditorStore((state) => state.tabs)

  const [entries, setEntries] = useState<RailEntry[]>(() =>
    stackGroups.map((group) => ({ key: group.key, phase: 'idle', tabs: group.tabs }))
  )
  const [signature, setSignature] = useState(() => groupsSignature(stackGroups))
  const nextSignature = groupsSignature(stackGroups)
  if (nextSignature !== signature) {
    setSignature(nextSignature)
    setEntries(mergeEntries(entries, stackGroups))
  }

  // Settle entering items and drop leaving ones once their animation has run.
  useEffect(() => {
    if (entries.every((entry) => entry.phase === 'idle')) {
      return
    }
    const timer = window.setTimeout(() => {
      setEntries((current) =>
        current
          .filter((entry) => entry.phase !== 'leaving')
          .map((entry) => (entry.phase === 'entering' ? { ...entry, phase: 'idle' } : entry))
      )
    }, RAIL_ITEM_TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [entries])

  const groupByKey = new Map(stackGroups.map((group) => [group.key, group]))
  const liveKeys = entries.filter((entry) => entry.phase !== 'leaving').map((entry) => entry.key)
  const pinnedByKey = new Map(pinnedTabs.map((tab) => [pinnedKey(tab), tab]))
  const navigableKeys: RailKey[] = [...liveKeys, ...pinnedByKey.keys()]
  const activePinnedTab = pinnedTabs.find((tab) => tab.id === activePinnedTabId)
  const selectedKey = resolveSelectedRailKey({
    activePinnedTab: activePinnedTab,
    value: value,
    liveKeys: liveKeys,
  })

  const itemRefs = useRef(new Map<RailKey, HTMLButtonElement>())
  const markerRef = useRef<HTMLDivElement | null>(null)
  const markerPlacedRef = useRef(false)

  useLayoutEffect(() => {
    const marker = markerRef.current
    const item = selectedKey ? itemRefs.current.get(selectedKey) : undefined
    const hasNoMarkerTarget = !marker || !item
    if (hasNoMarkerTarget) {
      markerPlacedRef.current = false
      return
    }
    // The first placement jumps; later ones slide.
    marker.dataset.animate = markerPlacedRef.current ? 'true' : 'false'
    marker.style.transform = `translateY(${item.offsetTop + (item.offsetHeight - MARKER_HEIGHT) / HALF_DIVISOR}px)`
    markerPlacedRef.current = true
  }, [selectedKey, entries])

  const [tooltip, setTooltip] = useState<{ key: RailKey; top: number } | null>(null)
  const tooltipTimerRef = useRef<number | null>(null)

  const clearTooltipTimer = () => {
    if (tooltipTimerRef.current !== null) {
      window.clearTimeout(tooltipTimerRef.current)
      tooltipTimerRef.current = null
    }
  }
  const hideTooltip = () => {
    clearTooltipTimer()
    setTooltip(null)
  }
  const scheduleTooltip = (key: RailKey) => {
    clearTooltipTimer()
    tooltipTimerRef.current = window.setTimeout(() => {
      tooltipTimerRef.current = null
      const item = itemRefs.current.get(key)
      if (!item) {
        return
      }
      setTooltip({
        key: key,
        top: item.offsetTop + (item.offsetHeight - TOOLTIP_HEIGHT) / HALF_DIVISOR,
      })
    }, RAIL_TOOLTIP_DELAY_MS)
  }
  useEffect(() => clearTooltipTimer, [])

  const isTabDirty = (tab: WorkspaceTab) => {
    if (tab.type === 'table-designer') {
      return designerTabs[tab.id]?.isDirty ?? false
    }
    if (tab.type === 'object-editor') {
      const editorTab = objectEditorTabs[tab.id]
      return editorTab ? editorTab.content !== editorTab.originalContent : false
    }
    return false
  }

  const selectKey = (key: RailKey) => {
    const pinnedTab = pinnedByKey.get(key)
    if (pinnedTab) {
      onSelectPinned?.(pinnedTab.id)
      return
    }
    onSelect(key as WorkspaceTabStackKey)
  }

  const focusMembersFromKey = (event: KeyboardEvent<HTMLButtonElement>, key: RailKey) => {
    if (pinnedByKey.has(key)) return
    event.preventDefault()
    hideTooltip()
    onFocusMembers?.(key as WorkspaceTabStackKey)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, key: RailKey) => {
    if (event.key === 'ArrowRight') {
      focusMembersFromKey(event, key)
      return
    }
    const resolveTarget = RAIL_NAVIGATION_TARGETS[event.key]
    if (!resolveTarget) return
    event.preventDefault()
    hideTooltip()
    const target = resolveTarget(navigableKeys, navigableKeys.indexOf(key))
    if (!target) return
    if (target !== key) {
      selectKey(target)
    }
    itemRefs.current.get(target)?.focus()
  }

  const setItemRef = (key: RailKey) => (node: HTMLButtonElement | null) => {
    if (!node) {
      itemRefs.current.delete(key)
      return
    }
    itemRefs.current.set(key, node)
  }

  const tabStopKey = selectedKey ?? navigableKeys[0] ?? null

  return (
    <div
      className={railClassName(className)}
      role="tablist"
      aria-orientation="vertical"
      aria-label="Tab groups"
      data-testid="workspace-group-rail"
    >
      <div
        ref={markerRef}
        className={styles.marker}
        hidden={!selectedKey}
        aria-hidden="true"
        data-testid="workspace-group-rail-marker"
      />
      {entries.map((entry) => {
        const live = entry.phase !== 'leaving'
        const tabs = groupByKey.get(entry.key)?.tabs ?? entry.tabs
        const count = tabs.length
        const label = WORKSPACE_TAB_STACK_META[entry.key].label
        const selected = live && entry.key === selectedKey
        const dirty = tabs.some(isTabDirty)
        const { IconComponent, testId } = getWorkspaceStackIconDescriptor(entry.key)
        return (
          <Button
            variant="bare"
            key={entry.key}
            ref={setItemRef(entry.key)}
            {...railItemAccessibility(live, selected)}
            className={styles.item}
            aria-label={`${label}, ${formatTabCount(count)}`}
            disabled={!live}
            tabIndex={entry.key === tabStopKey ? 0 : -1}
            data-phase={entry.phase === 'idle' ? undefined : entry.phase}
            data-selected={selected || undefined}
            data-testid={`workspace-group-rail-item-${entry.key}`}
            onClick={() => {
              hideTooltip()
              onSelect(entry.key)
            }}
            onMouseEnter={() => scheduleTooltip(entry.key)}
            onMouseLeave={hideTooltip}
            onKeyDown={(event) => handleKeyDown(event, entry.key)}
          >
            <span className={styles.iconWrap}>
              <IconComponent
                size={18}
                weight="regular"
                aria-hidden={true}
                data-testid={testId}
                className={styles.icon}
              />
              {dirty ? (
                <span
                  className={styles.dirty}
                  aria-hidden="true"
                  data-testid={`workspace-group-rail-dirty-${entry.key}`}
                />
              ) : null}
            </span>
            <span className={styles.count}>{count}</span>
          </Button>
        )
      })}
      {pinnedTabs.length > 0 ? (
        <div className={styles.pinnedSection} data-testid="workspace-group-rail-pinned">
          {pinnedTabs.map((tab) => {
            const key = pinnedKey(tab)
            const selected = key === selectedKey
            const { IconComponent, testId } = getWorkspaceTabIconDescriptor(tab)
            return (
              <Button
                variant="bare"
                key={tab.id}
                ref={setItemRef(key)}
                role="tab"
                className={`${styles.item} ${styles.pinnedItem}`}
                aria-selected={selected}
                aria-label={tab.label}
                tabIndex={key === tabStopKey ? 0 : -1}
                data-selected={selected || undefined}
                data-testid={`workspace-pinned-tab-${tab.type}`}
                onClick={() => {
                  hideTooltip()
                  onSelectPinned?.(tab.id)
                }}
                onMouseEnter={() => scheduleTooltip(key)}
                onMouseLeave={hideTooltip}
                onKeyDown={(event) => handleKeyDown(event, key)}
              >
                <IconComponent
                  size={18}
                  weight="regular"
                  aria-hidden={true}
                  data-testid={testId}
                  className={styles.icon}
                />
              </Button>
            )
          })}
        </div>
      ) : null}
      <RailTooltip
        tooltip={tooltip}
        group={tooltip ? groupByKey.get(tooltip.key as WorkspaceTabStackKey) : undefined}
        pinnedTab={tooltip ? pinnedByKey.get(tooltip.key) : undefined}
      />
    </div>
  )
}
