import { beforeEach, describe, expect, it } from 'vitest'
import {
  activateTab,
  appendRestoredTab,
  appendTab,
  applyAllConnectionNormalizations,
  applyConnectionNormalization,
  clearStackRecency,
  markTabPendingClose,
  patchObjectEditorTab,
  patchTableDesignerTab,
  prependHistoryTab,
  rememberFocusedSurface,
  removeClosedTab,
  removeConnection,
  removeMatchingTabs,
  setTabNavigationBlock,
  showTab,
  transformConnectionTabs,
  type WorkspaceTabsState,
} from '../../../stores/workspace-store/workspace-reducers'
import { normalizeScopedTableDataTabs } from '../../../stores/workspace-store/workspace-tab-lists'
import { SETTINGS_DEFAULTS, useSettingsStore } from '../../../stores/settings-store'
import type { WorkspaceTab } from '../../../types/schema'
import {
  CONNECTION_ID,
  designerTab,
  historyTab,
  objectEditorTab,
  queryTab,
  tableTab,
} from '../../helpers/workspace-tab-fixtures'

function stateWith(tabs: WorkspaceTab[], activeTabId: string | null = null): WorkspaceTabsState {
  return {
    tabsByConnection: { [CONNECTION_ID]: tabs },
    activeTabByConnection: { [CONNECTION_ID]: activeTabId },
    stackRecencyByConnection: {},
  }
}

function tabIds(state: Pick<WorkspaceTabsState, 'tabsByConnection'>): string[] {
  return state.tabsByConnection[CONNECTION_ID].map((tab) => tab.id)
}

beforeEach(() => {
  useSettingsStore.setState({
    settings: { ...SETTINGS_DEFAULTS, 'results.tableTabsInBottomPanel': 'false' },
  })
})

describe('workspace reducers', () => {
  it('appends a tab without touching the active tab', () => {
    const state = appendTab({ tabsByConnection: {} }, queryTab('q1'))
    expect(tabIds(state)).toEqual(['q1'])
  })

  it('activates a tab and stamps its use and stack recency', () => {
    const state = { ...stateWith([queryTab('q1'), queryTab('q2')], 'q1'), tabLastUsedAt: {} }
    const activated = activateTab(state, { connectionId: CONNECTION_ID, tabId: 'q2', usedAt: 7 })
    expect(activated.activeTabByConnection[CONNECTION_ID]).toBe('q2')
    expect(activated.tabLastUsedAt).toEqual({ q2: 7 })
    expect(activated.stackRecencyByConnection[CONNECTION_ID]).toEqual({ queries: 'q2' })
  })

  it('keeps the active tab when a transform leaves it open and falls back to the first tab', () => {
    const state = stateWith([queryTab('q1'), queryTab('q2')], 'q2')
    const kept = transformConnectionTabs(state, {
      connectionId: CONNECTION_ID,
      transform: (tabs) => [...tabs].reverse(),
    })
    expect(kept.activeTabByConnection[CONNECTION_ID]).toBe('q2')
    const dropped = transformConnectionTabs(state, {
      connectionId: CONNECTION_ID,
      transform: (tabs) => tabs.filter((tab) => tab.id !== 'q2'),
    })
    expect(dropped.activeTabByConnection[CONNECTION_ID]).toBe('q1')
  })

  it('removes matching tabs and activates the neighbour of a removed active tab', () => {
    const state = stateWith([queryTab('q1'), tableTab('t1'), tableTab('t2')], 't1')
    const removed = removeMatchingTabs(state, {
      connectionId: CONNECTION_ID,
      shouldRemove: (tab) => tab.id === 't1',
    })
    expect(tabIds(removed)).toEqual(['q1', 't2'])
    expect(removed.activeTabByConnection[CONNECTION_ID]).toBe('t2')
  })

  it('keeps the active tab when the removed tabs do not include it', () => {
    const state = stateWith([queryTab('q1'), tableTab('t1')], 'q1')
    const removed = removeMatchingTabs(state, {
      connectionId: CONNECTION_ID,
      shouldRemove: (tab) => tab.id === 't1',
    })
    expect(removed.activeTabByConnection[CONNECTION_ID]).toBe('q1')
  })

  it('appends a restored tab and activates it only when nothing is active', () => {
    const restored = appendRestoredTab(stateWith([], null), tableTab('t1'))
    expect(restored.activeTabByConnection[CONNECTION_ID]).toBe('t1')
    const keptActive = appendRestoredTab(stateWith([queryTab('q1')], 'q1'), tableTab('t1'))
    expect(keptActive.activeTabByConnection[CONNECTION_ID]).toBe('q1')
  })

  it('shows a tab by id', () => {
    const shown = showTab(stateWith([historyTab()], null), {
      connectionId: CONNECTION_ID,
      tabId: 'history',
    })
    expect(shown.activeTabByConnection[CONNECTION_ID]).toBe('history')
  })

  it('prepends the history tab and activates it only on request', () => {
    const state = stateWith([queryTab('q1')], 'q1')
    const background = prependHistoryTab(state, { tab: historyTab(), activate: false })
    expect(tabIds(background)).toEqual(['history', 'q1'])
    expect(background).not.toHaveProperty('activeTabByConnection')
    const foreground = prependHistoryTab(state, { tab: historyTab(), activate: true })
    expect(foreground).toMatchObject({ activeTabByConnection: { [CONNECTION_ID]: 'history' } })
  })

  it('marks one tab as pending close', () => {
    const marked = markTabPendingClose(stateWith([queryTab('q1'), queryTab('q2')]), {
      connectionId: CONNECTION_ID,
      tabId: 'q2',
    })
    expect(marked.tabsByConnection[CONNECTION_ID].map((tab) => tab.pendingClose)).toEqual([
      undefined,
      true,
    ])
  })

  it('removes a closed tab and clears a cascade close that waited on it', () => {
    const pendingCascadeClose = {
      queryTabId: 'q1',
      queryResultItems: [],
      tableDataItems: [],
      onConfirm: () => {},
      onCancel: () => {},
    }
    const state = {
      ...stateWith([queryTab('q1'), queryTab('q2')], 'q1'),
      pendingCascadeClose: pendingCascadeClose,
    }
    const closed = removeClosedTab(state, {
      connectionId: CONNECTION_ID,
      closingTabId: 'q1',
      nextActiveTabId: 'q2',
    })
    expect(tabIds(closed)).toEqual(['q2'])
    expect(closed.pendingCascadeClose).toBeNull()
    const other = removeClosedTab(state, {
      connectionId: CONNECTION_ID,
      closingTabId: 'q2',
      nextActiveTabId: 'q1',
    })
    expect(other.pendingCascadeClose).toBe(pendingCascadeClose)
  })

  it('applies a scoped-table normalization with a preferred active tab', () => {
    const tabs = [queryTab('q1'), tableTab('t1', { parentQueryTabId: 'q1' })]
    const normalization = {
      connectionId: CONNECTION_ID,
      normalized: normalizeScopedTableDataTabs(tabs),
      preferredActiveTabId: 't1',
    }
    const normalized = applyConnectionNormalization(stateWith(tabs, 'q1'), normalization)
    expect(normalized.activeTabByConnection[CONNECTION_ID]).toBe('t1')
    expect(normalized.tabsByConnection[CONNECTION_ID][1]).toMatchObject({
      parentQueryTabId: undefined,
    })
  })

  it('returns the same state when no connection needs normalizing', () => {
    const tabs = [queryTab('q1'), tableTab('t1')]
    const state = stateWith(tabs, 'q1')
    const normalization = {
      connectionId: CONNECTION_ID,
      normalized: normalizeScopedTableDataTabs(tabs),
      preferredActiveTabId: null,
    }
    expect(applyAllConnectionNormalizations(state, [normalization])).toBe(state)
  })

  it('normalizes every connection and falls back to the current active tab', () => {
    const tabs = [queryTab('q1'), tableTab('t1', { parentQueryTabId: 'q1' }), tableTab('t2')]
    const normalization = {
      connectionId: CONNECTION_ID,
      normalized: normalizeScopedTableDataTabs(tabs),
      preferredActiveTabId: null,
    }
    const normalized = applyAllConnectionNormalizations(stateWith(tabs, 'q1'), [normalization])
    expect(tabIds(normalized)).toEqual(['q1', 't1'])
    expect(normalized.activeTabByConnection).toEqual({ [CONNECTION_ID]: 'q1' })
  })

  it('patches a table designer tab and relabels it after its object name', () => {
    const state = stateWith([designerTab('d1'), queryTab('q1')])
    const patched = patchTableDesignerTab(state, { tabId: 'd1', partial: { objectName: 'people' } })
    expect(patched.tabsByConnection[CONNECTION_ID][0]).toMatchObject({
      objectName: 'people',
      label: 'people',
    })
    expect(patchTableDesignerTab(state, { tabId: 'q1', partial: { label: 'x' } })).toBe(state)
    expect(patchTableDesignerTab(state, { tabId: 'missing', partial: {} })).toBe(state)
  })

  it('patches an object editor tab and keeps its label unless one is given', () => {
    const state = stateWith([objectEditorTab('o1')])
    const patched = patchObjectEditorTab(state, { tabId: 'o1', partial: { mode: 'create' } })
    expect(patched.tabsByConnection[CONNECTION_ID][0]).toMatchObject({
      mode: 'create',
      label: 'View: active_users',
    })
    expect(patchObjectEditorTab(stateWith([queryTab('o1')]), { tabId: 'o1', partial: {} })).toEqual(
      stateWith([queryTab('o1')])
    )
  })

  it('records focus surface and navigation blocks per tab', () => {
    expect(
      rememberFocusedSurface({ lastFocusedSurfaceByTab: {} }, { tabId: 'q1', surface: 'ai-input' })
    ).toEqual({ lastFocusedSurfaceByTab: { q1: 'ai-input' } })
    expect(
      setTabNavigationBlock({ blockingNavigationByTab: {} }, { tabId: 'q1', blocking: true })
    ).toEqual({ blockingNavigationByTab: { q1: true } })
  })

  it('clears stack recency for one connection or all of them', () => {
    const state = { stackRecencyByConnection: { a: { queries: 'q1' }, b: { queries: 'q2' } } }
    expect(clearStackRecency(state, 'a')).toEqual({
      stackRecencyByConnection: { a: {}, b: { queries: 'q2' } },
    })
    expect(clearStackRecency(state, undefined)).toEqual({ stackRecencyByConnection: {} })
  })

  it('removes every trace of a connection', () => {
    expect(removeConnection(stateWith([queryTab('q1')], 'q1'), CONNECTION_ID)).toEqual({
      tabsByConnection: {},
      activeTabByConnection: {},
      stackRecencyByConnection: {},
    })
  })
})
