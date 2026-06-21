import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_TAB_STACK_META,
  getWorkspaceStackActivationTarget,
  getWorkspaceStackKeyForTab,
  groupWorkspaceTabsByStack,
  isPinnedWorkspaceTab,
} from '../../lib/workspace-tab-stacks'
import type { WorkspaceTab } from '../../types/schema'

function makeTab(
  tab: Partial<WorkspaceTab> & Pick<WorkspaceTab, 'id' | 'type' | 'label' | 'connectionId'>
): WorkspaceTab {
  switch (tab.type) {
    case 'query-editor':
      return { id: tab.id, type: 'query-editor', label: tab.label, connectionId: tab.connectionId }
    case 'table-data':
      return {
        id: tab.id,
        type: 'table-data',
        label: tab.label,
        connectionId: tab.connectionId,
        databaseName: 'db',
        objectName: tab.label,
        objectType: 'table',
        parentQueryTabId: 'parentQueryTabId' in tab ? tab.parentQueryTabId : undefined,
      }
    case 'table-designer':
      return {
        id: tab.id,
        type: 'table-designer',
        label: tab.label,
        connectionId: tab.connectionId,
        databaseName: 'db',
        objectName: tab.label,
        mode: 'alter',
      }
    case 'schema-info':
      return {
        id: tab.id,
        type: 'schema-info',
        label: tab.label,
        connectionId: tab.connectionId,
        databaseName: 'db',
        objectName: tab.label,
        objectType: 'table',
      }
    case 'object-editor':
      return {
        id: tab.id,
        type: 'object-editor',
        label: tab.label,
        connectionId: tab.connectionId,
        databaseName: 'db',
        objectName: tab.label,
        objectType: 'procedure',
        mode: 'alter',
      }
    case 'history':
      return { id: tab.id, type: 'history', label: tab.label, connectionId: tab.connectionId }
    case 'processlist':
      return { id: tab.id, type: 'processlist', label: tab.label, connectionId: tab.connectionId }
  }
}

describe('workspace-tab-stacks', () => {
  it('groups non-pinned tabs strictly by tab type and preserves member order', () => {
    const tabs = [
      makeTab({ id: 'q1', type: 'query-editor', label: 'Query 1', connectionId: 'conn-1' }),
      makeTab({ id: 'h1', type: 'history', label: 'History', connectionId: 'conn-1' }),
      makeTab({ id: 't1', type: 'table-data', label: 'users', connectionId: 'conn-1' }),
      makeTab({ id: 'q2', type: 'query-editor', label: 'Query 2', connectionId: 'conn-1' }),
      makeTab({ id: 's1', type: 'schema-info', label: 'orders', connectionId: 'conn-1' }),
      makeTab({ id: 'o1', type: 'object-editor', label: 'proc', connectionId: 'conn-1' }),
      makeTab({ id: 'd1', type: 'table-designer', label: 'users', connectionId: 'conn-1' }),
    ]

    expect(groupWorkspaceTabsByStack(tabs)).toEqual([
      { key: 'queries', tabs: [tabs[0], tabs[3]] },
      { key: 'tables', tabs: [tabs[2]] },
      { key: 'designers', tabs: [tabs[6]] },
      { key: 'schema', tabs: [tabs[4]] },
      { key: 'objects', tabs: [tabs[5]] },
    ])
  })

  it('excludes pinned tabs and hidden scoped table-data tabs from top-level stack membership', () => {
    const historyTab = makeTab({
      id: 'h1',
      type: 'history',
      label: 'History',
      connectionId: 'conn-1',
    })
    const scopedTableTab = makeTab({
      id: 't1',
      type: 'table-data',
      label: 'users',
      connectionId: 'conn-1',
      parentQueryTabId: 'q1',
    })

    expect(isPinnedWorkspaceTab(historyTab)).toBe(true)
    expect(getWorkspaceStackKeyForTab(historyTab)).toBeNull()
    expect(getWorkspaceStackKeyForTab(scopedTableTab, { hideScopedTableDataTabs: true })).toBeNull()
  })

  it('falls back to the first visible member when recency is missing or stale', () => {
    const queryTabs = [
      makeTab({ id: 'q1', type: 'query-editor', label: 'Query 1', connectionId: 'conn-1' }),
      makeTab({ id: 'q2', type: 'query-editor', label: 'Query 2', connectionId: 'conn-1' }),
    ]

    expect(getWorkspaceStackActivationTarget('queries', queryTabs, 'q2')?.id).toBe('q2')
    expect(getWorkspaceStackActivationTarget('queries', queryTabs, 'missing')?.id).toBe('q1')
    expect(getWorkspaceStackActivationTarget('queries', queryTabs, null)?.id).toBe('q1')
  })

  it('returns the most recent visible member for the requested stack', () => {
    const tabs = [
      makeTab({ id: 'q1', type: 'query-editor', label: 'Query 1', connectionId: 'conn-1' }),
      makeTab({ id: 't1', type: 'table-data', label: 'users', connectionId: 'conn-1' }),
      makeTab({ id: 'q2', type: 'query-editor', label: 'Query 2', connectionId: 'conn-1' }),
    ]

    expect(getWorkspaceStackActivationTarget('queries', tabs, 'q2')?.id).toBe('q2')
    expect(getWorkspaceStackActivationTarget('tables', tabs, 't1')?.id).toBe('t1')
  })

  it('defines full, compact, and icon-only labels for every stack chip', () => {
    expect(WORKSPACE_TAB_STACK_META).toEqual({
      queries: {
        key: 'queries',
        label: 'Queries',
        shortLabel: 'Qry',
        iconOnlyLabel: 'Queries',
      },
      tables: {
        key: 'tables',
        label: 'Tables',
        shortLabel: 'Tbl',
        iconOnlyLabel: 'Tables',
      },
      designers: {
        key: 'designers',
        label: 'Designers',
        shortLabel: 'Dsgn',
        iconOnlyLabel: 'Designers',
      },
      schema: {
        key: 'schema',
        label: 'Schema',
        shortLabel: 'Sch',
        iconOnlyLabel: 'Schema',
      },
      objects: {
        key: 'objects',
        label: 'Objects',
        shortLabel: 'Obj',
        iconOnlyLabel: 'Objects',
      },
    })
  })
})
