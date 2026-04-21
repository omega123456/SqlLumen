import { beforeEach, describe, expect, it } from 'vitest'
import {
  useWorkspaceStore,
  _resetTabIdCounter,
  _resetQueryTabCounter,
} from '../../stores/workspace-store'
import { useAiStore } from '../../stores/ai-store'

const CONN = 'conn-1'

beforeEach(() => {
  useWorkspaceStore.setState({
    tabsByConnection: {},
    activeTabByConnection: {},
  })
  useAiStore.setState({ tabs: {} })
  _resetTabIdCounter()
  _resetQueryTabCounter()
})

describe('openProcessListTab', () => {
  it('creates a processlist tab', () => {
    useWorkspaceStore.getState().openProcessListTab(CONN)
    const tabs = useWorkspaceStore.getState().tabsByConnection[CONN]
    expect(tabs).toHaveLength(1)
    expect(tabs[0].type).toBe('processlist')
    expect(tabs[0].label).toBe('Process List')
    expect(tabs[0].id).toBe(`processlist-${CONN}`)
  })

  it('is singleton — does not create duplicate', () => {
    useWorkspaceStore.getState().openProcessListTab(CONN)
    useWorkspaceStore.getState().openProcessListTab(CONN)
    const tabs = useWorkspaceStore.getState().tabsByConnection[CONN]
    expect(tabs).toHaveLength(1)
  })

  it('inserts after history tab', () => {
    useWorkspaceStore.getState().openHistoryTab(CONN, false)
    useWorkspaceStore.getState().openProcessListTab(CONN)
    const tabs = useWorkspaceStore.getState().tabsByConnection[CONN]
    expect(tabs).toHaveLength(2)
    expect(tabs[0].type).toBe('history')
    expect(tabs[1].type).toBe('processlist')
  })

  it('inserts at position 0 when no history tab', () => {
    // Add a query tab first
    useWorkspaceStore.getState().openQueryTab(CONN)
    useWorkspaceStore.getState().openProcessListTab(CONN)
    const tabs = useWorkspaceStore.getState().tabsByConnection[CONN]
    expect(tabs[0].type).toBe('processlist')
    expect(tabs[1].type).toBe('query-editor')
  })
})

describe('closeTab guards for processlist', () => {
  it('closeTab does not close processlist tab', () => {
    useWorkspaceStore.getState().openProcessListTab(CONN)
    const tabId = useWorkspaceStore.getState().tabsByConnection[CONN][0].id
    useWorkspaceStore.getState().closeTab(CONN, tabId)
    expect(useWorkspaceStore.getState().tabsByConnection[CONN]).toHaveLength(1)
  })

  it('forceCloseTab does not close processlist tab', () => {
    useWorkspaceStore.getState().openProcessListTab(CONN)
    const tabId = useWorkspaceStore.getState().tabsByConnection[CONN][0].id
    useWorkspaceStore.getState().forceCloseTab(CONN, tabId)
    expect(useWorkspaceStore.getState().tabsByConnection[CONN]).toHaveLength(1)
  })
})
