import { beforeEach, describe, expect, it } from 'vitest'
import { tabsWithTabMoved } from '../../../stores/workspace-store/workspace-tab-order'
import { SETTINGS_DEFAULTS, useSettingsStore } from '../../../stores/settings-store'
import type { WorkspaceTab } from '../../../types/schema'
import { historyTab, queryTab, tableTab } from '../../helpers/workspace-tab-fixtures'

function setTableTabsInBottomPanel(enabled: boolean): void {
  useSettingsStore.setState({
    settings: { ...SETTINGS_DEFAULTS, 'results.tableTabsInBottomPanel': String(enabled) },
  })
}

function idsOf(tabs: WorkspaceTab[]): string[] {
  return tabs.map((tab) => tab.id)
}

beforeEach(() => setTableTabsInBottomPanel(false))

describe('workspace tab order', () => {
  it('moves a tab forward and backward among the movable tabs', () => {
    const tabs = [historyTab(), queryTab('q1'), queryTab('q2'), queryTab('q3')]
    expect(idsOf(tabsWithTabMoved(tabs, { tabId: 'q1', insertIndex: 3 }))).toEqual([
      'history',
      'q2',
      'q3',
      'q1',
    ])
    expect(idsOf(tabsWithTabMoved(tabs, { tabId: 'q3', insertIndex: 0 }))).toEqual([
      'history',
      'q3',
      'q1',
      'q2',
    ])
  })

  it('clamps the insert position to the movable range', () => {
    const tabs = [queryTab('q1'), queryTab('q2')]
    expect(idsOf(tabsWithTabMoved(tabs, { tabId: 'q1', insertIndex: 99 }))).toEqual(['q2', 'q1'])
    expect(idsOf(tabsWithTabMoved(tabs, { tabId: 'q2', insertIndex: -5 }))).toEqual(['q2', 'q1'])
  })

  it('leaves the list alone for a pinned or unknown tab', () => {
    const tabs = [historyTab(), queryTab('q1')]
    expect(tabsWithTabMoved(tabs, { tabId: 'history', insertIndex: 1 })).toBe(tabs)
    expect(tabsWithTabMoved(tabs, { tabId: 'missing', insertIndex: 0 })).toBe(tabs)
  })

  it('moves a query tab together with its scoped tables', () => {
    setTableTabsInBottomPanel(true)
    const tabs = [
      queryTab('q1'),
      tableTab('t1', { parentQueryTabId: 'q1' }),
      queryTab('q2'),
      tableTab('t2'),
    ]
    expect(idsOf(tabsWithTabMoved(tabs, { tabId: 'q1', insertIndex: 4 }))).toEqual([
      'q2',
      't2',
      'q1',
      't1',
    ])
    expect(idsOf(tabsWithTabMoved(tabs, { tabId: 'q2', insertIndex: 0 }))).toEqual([
      'q2',
      'q1',
      't1',
      't2',
    ])
  })
})
