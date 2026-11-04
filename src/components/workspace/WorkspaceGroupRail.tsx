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
import styles from './WorkspaceGroupRail.module.css'

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

function mergeEntries(previous: RailEntry[], groups: WorkspaceTabStackGroup[]): RailEntry[] {
  const current = new Map(groups.map((group) => [group.key, group]))
  const before = new Map(previous.map((entry) => [entry.key, entry]))
  const next: RailEntry[] = []
  for (const key of WORKSPACE_TAB_STACK_ORDER) {
    const group = current.get(key)
    const prior = before.get(key)
    if (group) {
      const phase: RailItemPhase = !prior || prior.phase === 'leaving' ? 'entering' : prior.phase
      next.push({ key, phase, tabs: group.tabs })
    } else if (prior) {
      next.push({ key, phase: 'leaving', tabs: prior.tabs })
    }
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
  const pinnedKey = (tab: WorkspaceTab): RailKey => `pinned:${tab.type}`
  const pinnedByKey = new Map(pinnedTabs.map((tab) => [pinnedKey(tab), tab]))
  const navigableKeys: RailKey[] = [...liveKeys, ...pinnedByKey.keys()]
  const activePinnedTab = pinnedTabs.find((tab) => tab.id === activePinnedTabId)
  const selectedKey: RailKey | null = activePinnedTab
    ? pinnedKey(activePinnedTab)
    : value && liveKeys.includes(value)
      ? value
      : null

  const itemRefs = useRef(new Map<RailKey, HTMLButtonElement>())
  const markerRef = useRef<HTMLDivElement | null>(null)
  const markerPlacedRef = useRef(false)

  useLayoutEffect(() => {
    const marker = markerRef.current
    const item = selectedKey ? itemRefs.current.get(selectedKey) : undefined
    if (!marker || !item) {
      markerPlacedRef.current = false
      return
    }
    // The first placement jumps; later ones slide.
    marker.dataset.animate = markerPlacedRef.current ? 'true' : 'false'
    marker.style.transform = `translateY(${item.offsetTop + (item.offsetHeight - MARKER_HEIGHT) / 2}px)`
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
      setTooltip({ key, top: item.offsetTop + (item.offsetHeight - TOOLTIP_HEIGHT) / 2 })
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
    } else {
      onSelect(key as WorkspaceTabStackKey)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, key: RailKey) => {
    const index = navigableKeys.indexOf(key)
    let target: RailKey | undefined
    switch (event.key) {
      case 'ArrowDown':
        target = navigableKeys[(index + 1) % navigableKeys.length]
        break
      case 'ArrowUp':
        target = navigableKeys[(index - 1 + navigableKeys.length) % navigableKeys.length]
        break
      case 'Home':
        target = navigableKeys[0]
        break
      case 'End':
        target = navigableKeys[navigableKeys.length - 1]
        break
      case 'ArrowRight':
        if (pinnedByKey.has(key)) {
          return
        }
        event.preventDefault()
        hideTooltip()
        onFocusMembers?.(key as WorkspaceTabStackKey)
        return
      default:
        return
    }
    event.preventDefault()
    hideTooltip()
    if (target && target !== key) {
      selectKey(target)
    }
    if (target) {
      itemRefs.current.get(target)?.focus()
    }
  }

  const setItemRef = (key: RailKey) => (node: HTMLButtonElement | null) => {
    if (node) {
      itemRefs.current.set(key, node)
    } else {
      itemRefs.current.delete(key)
    }
  }

  const tabStopKey = selectedKey ?? navigableKeys[0] ?? null
  const tooltipGroup = tooltip ? groupByKey.get(tooltip.key as WorkspaceTabStackKey) : undefined
  const tooltipPinned = tooltip ? pinnedByKey.get(tooltip.key) : undefined

  return (
    <div
      className={className ? `${styles.rail} ${className}` : styles.rail}
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
          <button
            key={entry.key}
            ref={setItemRef(entry.key)}
            type="button"
            role={live ? 'tab' : undefined}
            className={styles.item}
            aria-selected={live ? selected : undefined}
            aria-label={`${label}, ${formatTabCount(count)}`}
            aria-hidden={live ? undefined : true}
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
          </button>
        )
      })}
      {pinnedTabs.length > 0 ? (
        <div className={styles.pinnedSection} data-testid="workspace-group-rail-pinned">
          {pinnedTabs.map((tab) => {
            const key = pinnedKey(tab)
            const selected = key === selectedKey
            const { IconComponent, testId } = getWorkspaceTabIconDescriptor(tab)
            return (
              <button
                key={tab.id}
                ref={setItemRef(key)}
                type="button"
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
              </button>
            )
          })}
        </div>
      ) : null}
      {tooltip && (tooltipGroup || tooltipPinned) ? (
        <div
          className={styles.tooltip}
          role="tooltip"
          style={{ top: tooltip.top }}
          data-testid="workspace-group-rail-tooltip"
        >
          {tooltipGroup ? (
            <>
              {WORKSPACE_TAB_STACK_META[tooltipGroup.key].label}
              <span className={styles.tooltipCount}>
                {formatTabCount(tooltipGroup.tabs.length)}
              </span>
            </>
          ) : (
            tooltipPinned?.label
          )}
        </div>
      ) : null}
    </div>
  )
}
