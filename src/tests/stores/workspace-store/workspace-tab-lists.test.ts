import { beforeEach, describe, expect, it } from 'vitest'
import {
  activeTabIdAfterRemoval,
  getNextStackRecency,
  isObjectScopedTab,
  normalizeScopedTableDataTabs,
  normalizeWorkspaceActiveTab,
  selectActiveTabAfterChange,
  tabsWithDatabaseRenamed,
  tabsWithObjectRenamed,
  tabsWithQueryTabRenamed,
  tabsWithSubTab,
} from '../../../stores/workspace-store/workspace-tab-lists'
import { SETTINGS_DEFAULTS, useSettingsStore } from '../../../stores/settings-store'
import {
  designerTab,
  historyTab,
  objectEditorTab,
  queryTab,
  tableTab,
} from '../../helpers/workspace-tab-fixtures'

function setTableTabsInBottomPanel(enabled: boolean): void {
  useSettingsStore.setState({
    settings: { ...SETTINGS_DEFAULTS, 'results.tableTabsInBottomPanel': String(enabled) },
  })
}

beforeEach(() => setTableTabsInBottomPanel(false))

describe('workspace tab lists', () => {
  it('recognises object-scoped tabs', () => {
    expect(isObjectScopedTab(tableTab('t1'))).toBe(true)
    expect(isObjectScopedTab(queryTab('q1'))).toBe(false)
  })

  it('selects the surviving active tab, else the first tab, else nothing', () => {
    const tabs = [queryTab('q1'), queryTab('q2')]
    expect(selectActiveTabAfterChange('q2', tabs)).toBe('q2')
    expect(selectActiveTabAfterChange('gone', tabs)).toBe('q1')
    expect(selectActiveTabAfterChange(null, [])).toBeNull()
  })

  it('prefers a same-stack neighbour after closing the active tab', () => {
    const tabs = [tableTab('t1'), queryTab('q1'), tableTab('t2')]
    expect(activeTabIdAfterRemoval('t2', tabs[2], tabs)).toBe('t1')
    expect(activeTabIdAfterRemoval('t1', tabs[0], tabs)).toBe('t2')
    expect(activeTabIdAfterRemoval('q1', tabs[2], tabs)).toBe('q1')
  })

  it('falls back to the adjacent tab when the closing stack empties', () => {
    const tabs = [queryTab('q1'), tableTab('t1')]
    expect(activeTabIdAfterRemoval('t1', tabs[1], tabs)).toBe('q1')
    expect(activeTabIdAfterRemoval('q1', tabs[0], [tabs[0]])).toBeNull()
  })

  it('drops stale recency entries, follows remapped ids and records the active tab', () => {
    const tabs = [queryTab('q1'), tableTab('t1')]
    const recency = getNextStackRecency({
      tabs: tabs,
      currentRecency: { queries: 'gone', tables: 'old-table' },
      activeTabId: null,
      remappedTableTabIds: new Map([['old-table', 't1']]),
    })
    expect(recency).toEqual({ tables: 't1' })
    expect(
      getNextStackRecency({ tabs: tabs, currentRecency: undefined, activeTabId: 'q1' })
    ).toEqual({ queries: 'q1' })
    expect(
      getNextStackRecency({ tabs: tabs, currentRecency: { tables: 'x' }, activeTabId: 'missing' })
    ).toEqual({})
  })

  it('unscopes table tabs and removes duplicates of a standalone table', () => {
    const tabs = [queryTab('q1'), tableTab('t1'), tableTab('t2', { parentQueryTabId: 'q1' })]
    const normalized = normalizeScopedTableDataTabs(tabs)
    expect(normalized.tabs.map((tab) => tab.id)).toEqual(['q1', 't1'])
    expect(normalized.removedTableTabIds).toEqual(['t2'])
    expect(normalized.remappedTableTabIds.get('t2')).toBe('t1')
    const untouched = [queryTab('q1'), tableTab('t1')]
    expect(normalizeScopedTableDataTabs(untouched).tabs).toBe(untouched)
  })

  it('redirects an active scoped table to its open parent query tab', () => {
    const scoped = tableTab('t1', { parentQueryTabId: 'q1' })
    expect(normalizeWorkspaceActiveTab([queryTab('q1'), scoped], 't1')).toBe('q1')
    expect(normalizeWorkspaceActiveTab([scoped], 't1')).toBe('t1')
    expect(normalizeWorkspaceActiveTab([queryTab('q1')], null)).toBe('q1')
    expect(normalizeWorkspaceActiveTab([], null)).toBeNull()
    expect(normalizeWorkspaceActiveTab([queryTab('q1')], 'q1')).toBe('q1')
  })

  it('renames only the targeted query tab', () => {
    const tabs = [queryTab('q1', 'Query 1'), tableTab('t1'), historyTab()]
    const renamed = tabsWithQueryTabRenamed(tabs, { tabId: 'q1', label: 'Report' })
    expect(renamed[0].label).toBe('Report')
    expect(tabsWithQueryTabRenamed(tabs, { tabId: 't1', label: 'Report' })[1]).toBe(tabs[1])
    expect(tabsWithQueryTabRenamed(tabs, { tabId: 'q1', label: 'Query 1' })[0]).toBe(tabs[0])
  })

  it('moves object tabs to a renamed database', () => {
    const tabs = [queryTab('q1'), tableTab('t1'), objectEditorTab('o1')]
    const renamed = tabsWithDatabaseRenamed(tabs, { oldDatabase: 'shop', newDatabase: 'store' })
    expect(renamed[0]).toBe(tabs[0])
    expect(renamed[1]).toMatchObject({ databaseName: 'store', label: 'users' })
    expect(renamed[2]).toMatchObject({ databaseName: 'store', label: 'View: active_users' })
    expect(tabsWithDatabaseRenamed(tabs, { oldDatabase: 'other', newDatabase: 'store' })[1]).toBe(
      tabs[1]
    )
  })

  it('relabels tabs of a renamed object', () => {
    const tabs = [queryTab('q1'), designerTab('d1'), objectEditorTab('o1')]
    const renamedTable = tabsWithObjectRenamed(tabs, {
      databaseName: 'shop',
      oldObjectName: 'users',
      newObjectName: 'people',
    })
    expect(renamedTable[1]).toMatchObject({ objectName: 'people', label: 'people' })
    expect(renamedTable[2]).toBe(tabs[2])
    const renamedView = tabsWithObjectRenamed(tabs, {
      databaseName: 'shop',
      oldObjectName: 'active_users',
      newObjectName: 'live_users',
    })
    expect(renamedView[2]).toMatchObject({ label: 'View: live_users' })
  })

  it('sets the sub tab of one tab', () => {
    const tabs = [tableTab('t1'), tableTab('t2')]
    const updated = tabsWithSubTab(tabs, { tabId: 't2', subTab: 'ddl' })
    expect(updated.map((tab) => tab.subTabId)).toEqual([undefined, 'ddl'])
  })

  it('keeps focus inside the queries stack when scoped tables live in the bottom panel', () => {
    setTableTabsInBottomPanel(true)
    const tabs = [queryTab('q1'), tableTab('t1', { parentQueryTabId: 'q1' }), queryTab('q2')]
    expect(activeTabIdAfterRemoval('q2', tabs[2], tabs)).toBe('q1')
  })
})
