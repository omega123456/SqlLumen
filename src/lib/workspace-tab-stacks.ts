import type { WorkspaceTab } from '../types/schema'

export type WorkspaceTabStackKey = 'queries' | 'tables' | 'designers' | 'schema' | 'objects'

export interface WorkspaceTabStackMeta {
  key: WorkspaceTabStackKey
  label: string
  shortLabel: string
  iconOnlyLabel: string
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
  queries: { key: 'queries', label: 'Queries', shortLabel: 'Qry', iconOnlyLabel: 'Queries' },
  tables: { key: 'tables', label: 'Tables', shortLabel: 'Tbl', iconOnlyLabel: 'Tables' },
  designers: {
    key: 'designers',
    label: 'Designers',
    shortLabel: 'Dsgn',
    iconOnlyLabel: 'Designers',
  },
  schema: { key: 'schema', label: 'Schema', shortLabel: 'Sch', iconOnlyLabel: 'Schema' },
  objects: { key: 'objects', label: 'Objects', shortLabel: 'Obj', iconOnlyLabel: 'Objects' },
}

export function isPinnedWorkspaceTab(tab: WorkspaceTab): boolean {
  return tab.type === 'history' || tab.type === 'processlist'
}

export function getWorkspaceStackKeyForTab(
  tab: WorkspaceTab,
  options: WorkspaceTabStackResolutionOptions = {}
): WorkspaceTabStackKey | null {
  if (isPinnedWorkspaceTab(tab)) {
    return null
  }

  if (tab.type === 'table-data' && options.hideScopedTableDataTabs && tab.parentQueryTabId) {
    return null
  }

  switch (tab.type) {
    case 'query-editor':
      return 'queries'
    case 'table-data':
      return 'tables'
    case 'table-designer':
      return 'designers'
    case 'schema-info':
      return 'schema'
    case 'object-editor':
      return 'objects'
    case 'history':
    case 'processlist':
      return null
  }
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

  return WORKSPACE_TAB_STACK_ORDER.map((key) => ({ key, tabs: groups.get(key) ?? [] })).filter(
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
