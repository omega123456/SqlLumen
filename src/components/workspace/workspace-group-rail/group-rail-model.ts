import type { WorkspaceTab } from '../../../types/schema'
import {
  WORKSPACE_TAB_STACK_ORDER,
  type WorkspaceTabStackGroup,
  type WorkspaceTabStackKey,
} from '../../../lib/workspace-tab-stacks'
import styles from '../WorkspaceGroupRail.module.css'
import { HALF_DIVISOR } from '../../../lib/units'

export const RAIL_ITEM_TRANSITION_MS = 150
export const RAIL_TOOLTIP_DELAY_MS = 450

export type RailItemPhase = 'idle' | 'entering' | 'leaving'

export type RailKey = WorkspaceTabStackKey | `pinned:${string}`

export interface RailEntry {
  key: WorkspaceTabStackKey
  phase: RailItemPhase
  tabs: WorkspaceTab[]
}

export interface RailTooltipState {
  key: RailKey
  top: number
}

export function formatTabCount(count: number): string {
  return `${count} ${count === 1 ? 'tab' : 'tabs'}`
}

export function groupsSignature(groups: WorkspaceTabStackGroup[]): string {
  return groups.map((group) => group.key).join(',')
}

type RailNavigationTarget = (keys: RailKey[], index: number) => RailKey | undefined

export const RAIL_NAVIGATION_TARGETS: Record<string, RailNavigationTarget> = {
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

export function pinnedKey(tab: WorkspaceTab): RailKey {
  return `pinned:${tab.type}`
}

interface SelectedRailKeyInputs {
  activePinnedTab: WorkspaceTab | undefined
  value: WorkspaceTabStackKey | null
  liveKeys: WorkspaceTabStackKey[]
}

export function resolveSelectedRailKey(inputs: SelectedRailKeyInputs): RailKey | null {
  if (inputs.activePinnedTab) return pinnedKey(inputs.activePinnedTab)
  const selectedValue = inputs.value
  if (!selectedValue) return null
  return inputs.liveKeys.includes(selectedValue) ? selectedValue : null
}

export function railClassName(className: string | undefined): string {
  return className ? `${styles.rail} ${className}` : styles.rail
}

export function railItemAccessibility(live: boolean, selected: boolean) {
  if (!live) return { role: undefined, 'aria-selected': undefined, 'aria-hidden': true }
  return { role: 'tab', 'aria-selected': selected, 'aria-hidden': undefined }
}

export function mergeEntries(previous: RailEntry[], groups: WorkspaceTabStackGroup[]): RailEntry[] {
  const current = new Map(groups.map((group) => [group.key, group]))
  const before = new Map(previous.map((entry) => [entry.key, entry]))
  const next: RailEntry[] = []
  for (const key of WORKSPACE_TAB_STACK_ORDER) {
    const entry = mergedEntry(key, current.get(key), before.get(key))
    if (entry) next.push(entry)
  }
  return next
}

function settledEntry(entry: RailEntry): RailEntry {
  if (entry.phase !== 'entering') return entry
  return { ...entry, phase: 'idle' }
}

export function settleEntries(entries: RailEntry[]): RailEntry[] {
  return entries.filter((entry) => entry.phase !== 'leaving').map(settledEntry)
}

export function initialEntries(stackGroups: WorkspaceTabStackGroup[]): RailEntry[] {
  return stackGroups.map((group) => ({ key: group.key, phase: 'idle', tabs: group.tabs }))
}

export function centeredOffset(item: HTMLElement, height: number): number {
  return item.offsetTop + (item.offsetHeight - height) / HALF_DIVISOR
}
