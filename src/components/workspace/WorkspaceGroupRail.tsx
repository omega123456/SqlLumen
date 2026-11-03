/**
 * WorkspaceGroupRail — the tab-group switcher at the workspace's left edge.
 *
 * One item per group with open tabs: the group icon over its tab count. The shown group gets a
 * neutral marker that slides between items; hovering an item shows the group name and count in a
 * tooltip. Groups that appear or disappear fade in and out so the rail doesn't jump.
 *
 * Keyboard: the rail is one tab stop (roving tabindex). Arrow Up/Down (and Home/End) select the
 * neighbouring group; Arrow Right moves focus into the shown group's tabs.
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
import { getWorkspaceStackIconDescriptor } from './workspace-tab-icons'
import styles from './WorkspaceGroupRail.module.css'

/** Matches the enter/leave animation length in WorkspaceGroupRail.module.css. */
export const RAIL_ITEM_TRANSITION_MS = 150
/** Hover time before the tooltip shows (proposal prototype). */
export const RAIL_TOOLTIP_DELAY_MS = 450
const MARKER_HEIGHT = 24
const TOOLTIP_HEIGHT = 28

type RailItemPhase = 'idle' | 'entering' | 'leaving'

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

  const itemRefs = useRef(new Map<WorkspaceTabStackKey, HTMLButtonElement>())
  const markerRef = useRef<HTMLDivElement | null>(null)
  const markerPlacedRef = useRef(false)

  useLayoutEffect(() => {
    const marker = markerRef.current
    const item = value ? itemRefs.current.get(value) : undefined
    if (!marker || !item) {
      markerPlacedRef.current = false
      return
    }
    // The first placement jumps; later ones slide.
    marker.dataset.animate = markerPlacedRef.current ? 'true' : 'false'
    marker.style.transform = `translateY(${item.offsetTop + (item.offsetHeight - MARKER_HEIGHT) / 2}px)`
    markerPlacedRef.current = true
  }, [value, entries])

  const [tooltip, setTooltip] = useState<{ key: WorkspaceTabStackKey; top: number } | null>(null)
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
  const scheduleTooltip = (key: WorkspaceTabStackKey) => {
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

  const focusItem = (key: WorkspaceTabStackKey) => {
    itemRefs.current.get(key)?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, key: WorkspaceTabStackKey) => {
    const index = liveKeys.indexOf(key)
    let target: WorkspaceTabStackKey | undefined
    switch (event.key) {
      case 'ArrowDown':
        target = liveKeys[(index + 1) % liveKeys.length]
        break
      case 'ArrowUp':
        target = liveKeys[(index - 1 + liveKeys.length) % liveKeys.length]
        break
      case 'Home':
        target = liveKeys[0]
        break
      case 'End':
        target = liveKeys[liveKeys.length - 1]
        break
      case 'ArrowRight':
        event.preventDefault()
        hideTooltip()
        onFocusMembers?.(key)
        return
      default:
        return
    }
    event.preventDefault()
    hideTooltip()
    if (target && target !== key) {
      onSelect(target)
    }
    if (target) {
      focusItem(target)
    }
  }

  const tabStopKey = value && liveKeys.includes(value) ? value : (liveKeys[0] ?? null)
  const tooltipGroup = tooltip ? groupByKey.get(tooltip.key) : undefined

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
        hidden={!value || !liveKeys.includes(value)}
        aria-hidden="true"
        data-testid="workspace-group-rail-marker"
      />
      {entries.map((entry) => {
        const live = entry.phase !== 'leaving'
        const tabs = groupByKey.get(entry.key)?.tabs ?? entry.tabs
        const count = tabs.length
        const label = WORKSPACE_TAB_STACK_META[entry.key].label
        const selected = live && entry.key === value
        const dirty = tabs.some(isTabDirty)
        const { IconComponent, testId } = getWorkspaceStackIconDescriptor(entry.key)
        return (
          <button
            key={entry.key}
            ref={(node) => {
              if (node) {
                itemRefs.current.set(entry.key, node)
              } else {
                itemRefs.current.delete(entry.key)
              }
            }}
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
      {tooltip && tooltipGroup ? (
        <div
          className={styles.tooltip}
          role="tooltip"
          style={{ top: tooltip.top }}
          data-testid="workspace-group-rail-tooltip"
        >
          {WORKSPACE_TAB_STACK_META[tooltip.key].label}
          <span className={styles.tooltipCount}>{formatTabCount(tooltipGroup.tabs.length)}</span>
        </div>
      ) : null}
    </div>
  )
}
