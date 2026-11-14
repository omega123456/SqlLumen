import type { PaletteSearchResult } from '../../lib/command-palette-search'
import { useQueryStore } from '../../stores/query-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type { PaletteTypeFilter, TableDataTab, WorkspaceTab } from '../../types/schema'
import { isScopedTableDataTabOf } from '../../lib/workspace-tab-stacks'
import { isSameTextIgnoringCase } from '../../lib/value-checks'
import { TYPE_ALIASES } from './slash-options'
import type { CommandPaletteFilterPillValue } from './palette-types'

const MAX_FILTER_PILLS = 2

export function addOrReplacePill(
  pills: ReadonlyArray<CommandPaletteFilterPillValue>,
  nextPill: CommandPaletteFilterPillValue
): CommandPaletteFilterPillValue[] {
  const withoutSameKind = pills.filter((pill) => pill.kind !== nextPill.kind)
  const withNewPill = [...withoutSameKind, nextPill]
  return withNewPill.slice(-MAX_FILTER_PILLS)
}

export function getSearchFilters(pills: ReadonlyArray<CommandPaletteFilterPillValue>) {
  return {
    database: pills.find((pill) => pill.kind === 'database')?.value ?? null,
    objectType:
      (pills.find((pill) => pill.kind === 'object-type')?.value as PaletteTypeFilter | undefined) ??
      null,
    table: pills.find((pill) => pill.kind === 'table')?.label ?? null,
  }
}

function scopedBottomPanelTableTab(
  tabs: WorkspaceTab[],
  activeTab: WorkspaceTab | undefined
): TableDataTab | undefined {
  if (activeTab?.type !== 'query-editor') return undefined
  const bottomPanelItem = useQueryStore.getState().tabs[activeTab.id]?.activeBottomPanelItem
  if (bottomPanelItem?.type !== 'table-data') return undefined
  const bottomPanelTab = tabs.find((tab) => tab.id === bottomPanelItem.tabId)
  return isScopedTableDataTabOf(bottomPanelTab, activeTab.id) ? bottomPanelTab : undefined
}

function resolveActiveTableTab(
  tabs: WorkspaceTab[],
  activeTab: WorkspaceTab | undefined
): TableDataTab | undefined {
  if (activeTab?.type === 'table-data') return activeTab
  return scopedBottomPanelTableTab(tabs, activeTab)
}

export function getInitialPills(connectionId: string | null): CommandPaletteFilterPillValue[] {
  if (!connectionId) return []

  const workspace = useWorkspaceStore.getState()
  const tabs = workspace.tabsByConnection[connectionId] ?? []
  const activeTabId = workspace.activeTabByConnection[connectionId]
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const tableTab = resolveActiveTableTab(tabs, activeTab)

  if (!tableTab) return []

  return [
    {
      kind: 'database',
      value: tableTab.databaseName,
      label: tableTab.databaseName,
    },
    {
      kind: 'table',
      value: `${tableTab.databaseName}.${tableTab.objectName}`,
      label: tableTab.objectName,
    },
  ]
}

interface ParsedSlashState {
  query: string
  pills: CommandPaletteFilterPillValue[]
  isSlashDropdownOpen: boolean
  slashQuery: string
}

function slashTokenPill(
  token: string,
  databases: ReadonlyArray<string>
): CommandPaletteFilterPillValue | null {
  const typeMatch = TYPE_ALIASES.get(token)
  if (typeMatch) return typeMatch
  const databaseMatch = databases.find((database) => isSameTextIgnoringCase(database, token))
  if (!databaseMatch) return null
  return { kind: 'database', value: databaseMatch, label: databaseMatch }
}

export function isSamePill(
  pill: CommandPaletteFilterPillValue,
  candidate: CommandPaletteFilterPillValue
): boolean {
  return pill.kind === candidate.kind && pill.value === candidate.value
}

function hasPill(
  pills: ReadonlyArray<CommandPaletteFilterPillValue>,
  candidate: CommandPaletteFilterPillValue
): boolean {
  return pills.some((pill) => isSamePill(pill, candidate))
}

export function tableScopePills(result: PaletteSearchResult): CommandPaletteFilterPillValue[] {
  return [
    {
      kind: 'database',
      value: result.database,
      label: result.database,
    },
    {
      kind: 'table',
      value: `${result.database}.${result.name}`,
      label: result.name,
    },
  ]
}

export function parseCommandPaletteValue(
  value: string,
  pills: ReadonlyArray<CommandPaletteFilterPillValue>,
  databases: ReadonlyArray<string>
): ParsedSlashState {
  const nextPills = [...pills]
  let remainder = value.trimStart()

  while (remainder.startsWith('/')) {
    const tokenMatch = /^\/([^\s]+)(?:\s+|$)/.exec(remainder)
    if (!tokenMatch) {
      break
    }

    const token = tokenMatch[1].toLowerCase()
    const nextPill = slashTokenPill(token, databases)
    if (!nextPill) {
      return {
        query: value,
        pills: nextPills,
        isSlashDropdownOpen: true,
        slashQuery: token,
      }
    }

    if (!hasPill(nextPills, nextPill)) {
      nextPills.splice(0, nextPills.length, ...addOrReplacePill(nextPills, nextPill))
    }

    remainder = remainder.slice(tokenMatch[0].length).trimStart()
  }

  const slashMatch = /(?:^|\s)\/([^\s]*)$/.exec(value)

  const hasNoPillTokens = remainder === value.trimStart()
  return {
    query: hasNoPillTokens ? value : remainder,
    pills: nextPills,
    isSlashDropdownOpen: slashMatch != null,
    slashQuery: slashMatch?.[1] ?? '',
  }
}
