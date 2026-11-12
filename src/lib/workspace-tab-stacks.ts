import type { TableDataTab, WorkspaceTab } from '../types/schema'

export type WorkspaceTabStackKey = 'queries' | 'tables' | 'designers' | 'schema' | 'objects'

export interface WorkspaceTabStackMeta {
  key: WorkspaceTabStackKey
  label: string
}

export interface WorkspaceTabStackGroup {
  key: WorkspaceTabStackKey
  tabs: WorkspaceTab[]
}

export interface WorkspaceTabStackResolutionOptions {
  hideScopedTableDataTabs?: boolean
}

export const WORKSPACE_TAB_STACK_ORDER: WorkspaceTabStackKey[] = [
  'queries',
  'tables',
  'designers',
  'schema',
  'objects',
]

export const WORKSPACE_TAB_STACK_META: Record<WorkspaceTabStackKey, WorkspaceTabStackMeta> = {
  queries: { key: 'queries', label: 'Queries' },
  tables: { key: 'tables', label: 'Tables' },
  designers: { key: 'designers', label: 'Designers' },
  schema: { key: 'schema', label: 'Schema' },
  objects: { key: 'objects', label: 'Objects' },
}

export type ScopedTableDataTab = TableDataTab & { parentQueryTabId: string }

export function isPinnedWorkspaceTab(tab: WorkspaceTab): boolean {
  return tab.type === 'history' || tab.type === 'processlist'
}

export function isScopedTableDataTab(
  tab: WorkspaceTab | null | undefined
): tab is ScopedTableDataTab {
  if (tab?.type !== 'table-data') return false
  return Boolean(tab.parentQueryTabId)
}

export function isScopedTableDataTabOf(
  tab: WorkspaceTab | null | undefined,
  queryTabId: string
): tab is ScopedTableDataTab {
  return isScopedTableDataTab(tab) && tab.parentQueryTabId === queryTabId
}

const STACK_KEY_BY_TAB_TYPE: Record<WorkspaceTab['type'], WorkspaceTabStackKey | null> = {
  'query-editor': 'queries',
  'table-data': 'tables',
  'table-designer': 'designers',
  'schema-info': 'schema',
  'object-editor': 'objects',
  history: null,
  processlist: null,
}

function isHiddenScopedTableDataTab(
  tab: WorkspaceTab,
  options: WorkspaceTabStackResolutionOptions
): boolean {
  if (tab.type !== 'table-data') {
    return false
  }
  return Boolean(options.hideScopedTableDataTabs && tab.parentQueryTabId)
}

export function getWorkspaceStackKeyForTab(
  tab: WorkspaceTab,
  options: WorkspaceTabStackResolutionOptions = {}
): WorkspaceTabStackKey | null {
  if (isHiddenScopedTableDataTab(tab, options)) {
    return null
  }
  return STACK_KEY_BY_TAB_TYPE[tab.type]
}

export function groupWorkspaceTabsByStack(
  tabs: WorkspaceTab[],
  options: WorkspaceTabStackResolutionOptions = {}
): WorkspaceTabStackGroup[] {
  const groups = new Map<WorkspaceTabStackKey, WorkspaceTab[]>()

  for (const key of WORKSPACE_TAB_STACK_ORDER) {
    groups.set(key, [])
  }

  for (const tab of tabs) {
    const stackKey = getWorkspaceStackKeyForTab(tab, options)
    if (!stackKey) {
      continue
    }

    groups.get(stackKey)?.push(tab)
  }

  return WORKSPACE_TAB_STACK_ORDER.map((key) => ({ key: key, tabs: groups.get(key) ?? [] })).filter(
    (group) => group.tabs.length > 0
  )
}

export function getWorkspaceStackMemberIds(
  tabs: WorkspaceTab[],
  options: WorkspaceTabStackResolutionOptions = {}
): Record<WorkspaceTabStackKey, Set<string>> {
  return {
    queries: new Set(
      tabs
        .filter((tab) => getWorkspaceStackKeyForTab(tab, options) === 'queries')
        .map((tab) => tab.id)
    ),
    tables: new Set(
      tabs
        .filter((tab) => getWorkspaceStackKeyForTab(tab, options) === 'tables')
        .map((tab) => tab.id)
    ),
    designers: new Set(
      tabs
        .filter((tab) => getWorkspaceStackKeyForTab(tab, options) === 'designers')
        .map((tab) => tab.id)
    ),
    schema: new Set(
      tabs
        .filter((tab) => getWorkspaceStackKeyForTab(tab, options) === 'schema')
        .map((tab) => tab.id)
    ),
    objects: new Set(
      tabs
        .filter((tab) => getWorkspaceStackKeyForTab(tab, options) === 'objects')
        .map((tab) => tab.id)
    ),
  }
}

export function getWorkspaceStackActivationTarget(
  stackKey: WorkspaceTabStackKey,
  tabs: WorkspaceTab[],
  recentTabId: string | null | undefined,
  options: WorkspaceTabStackResolutionOptions = {}
): WorkspaceTab | null {
  const members = tabs.filter((tab) => getWorkspaceStackKeyForTab(tab, options) === stackKey)
  if (members.length === 0) {
    return null
  }

  if (recentTabId) {
    const recentMember = members.find((tab) => tab.id === recentTabId)
    if (recentMember) {
      return recentMember
    }
  }

  return members[0]
}
