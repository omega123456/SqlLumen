import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WorkspaceBody } from '../../../components/layout/WorkspaceBody'
import { WORKSPACE_LAYOUT_EVENT } from '../../../lib/workspace-layout-events'
import { useAiStore, type TabAiState } from '../../../stores/ai-store'
import type { WorkspaceTab } from '../../../types/schema'

const panelRenders: Array<Record<string, unknown>> = []
const panelState = { collapsed: false }
const panelRef = {
  current: {
    expand: vi.fn(() => {
      panelState.collapsed = false
    }),
    collapse: vi.fn(() => {
      panelState.collapsed = true
    }),
    isCollapsed: vi.fn(() => panelState.collapsed),
  },
}

vi.mock('react-resizable-panels', async () => {
  const React = await import('react')
  return {
    Group: (props: Record<string, unknown>) =>
      React.createElement('div', { 'data-testid': 'rsp-group' }, props.children as React.ReactNode),
    Panel: (props: Record<string, unknown>) => {
      panelRenders.push(props)
      return React.createElement(
        'div',
        { 'data-testid': 'rsp-panel' },
        props.children as React.ReactNode
      )
    },
    Separator: (props: Record<string, unknown>) =>
      React.createElement(
        'div',
        { 'data-testid': 'rsp-separator' },
        props.children as React.ReactNode
      ),
    usePanelRef: () => panelRef,
  }
})

vi.mock('../../../components/ai-panel/AiPanel', () => ({
  AiPanel: ({ tabId }: { tabId: string }) => (
    <div data-testid="mock-ai-panel" data-tab-id={tabId} />
  ),
}))

vi.mock('../../../components/query-editor/ai-diff-bridge-context', () => ({
  useAiDiffTrigger: () => vi.fn(),
}))

const queryTabOne: WorkspaceTab = {
  id: 'query-1',
  type: 'query-editor',
  label: 'Query 1',
  connectionId: 'conn-1',
}

const queryTabTwo: WorkspaceTab = {
  id: 'query-2',
  type: 'query-editor',
  label: 'Query 2',
  connectionId: 'conn-1',
}

const tableTab: WorkspaceTab = {
  id: 'table-1',
  type: 'table-data',
  label: 'users',
  connectionId: 'conn-1',
  databaseName: 'app',
  objectName: 'users',
  objectType: 'table',
}

function emptyAiTabState(overrides: Partial<TabAiState> = {}): TabAiState {
  return {
    messages: [],
    isGenerating: false,
    activeStreamId: null,
    previousResponseId: null,
    attachedContext: null,
    isPanelOpen: false,
    error: null,
    providedChunkKeys: {},
    cumulativeSchemaTokens: 0,
    providedMemoryIds: {},
    lastCompletedSystemPrompt: '',
    lastCompletedTransport: null,
    lastCompletedEndpoint: '',
    lastCompletedModel: '',
    activeRequestEndpoint: '',
    activeRequestModel: '',
    activeStreamHasAssistantOutput: false,
    isWaitingForIndex: false,
    connectionId: null,
    _unlisten: null,
    ...overrides,
  }
}

function renderWorkspaceBody(activeTabId: string | null) {
  return render(
    <WorkspaceBody
      tabs={[queryTabOne, queryTabTwo, tableTab]}
      activeTabId={activeTabId}
      connectionId="conn-1"
      renderTabStack={() => <div data-testid="tab-stack-slot">tab stack</div>}
    />
  )
}

beforeEach(() => {
  panelRenders.length = 0
  panelState.collapsed = false
  panelRef.current.expand.mockClear()
  panelRef.current.collapse.mockClear()
  panelRef.current.isCollapsed.mockClear()
  useAiStore.setState({
    tabs: {
      'query-1': emptyAiTabState({ isPanelOpen: true }),
      'query-2': emptyAiTabState({ isPanelOpen: false }),
    },
  })
})

describe('WorkspaceBody', () => {
  it('renders the renderTabStack slot', () => {
    renderWorkspaceBody('query-1')
    expect(screen.getByTestId('tab-stack-slot')).toBeInTheDocument()
  })

  it('renders one AiPanel instance for each query tab', () => {
    renderWorkspaceBody('query-1')
    const panels = screen.getAllByTestId('mock-ai-panel')
    expect(panels).toHaveLength(2)
    expect(panels.map((panel) => panel.dataset.tabId)).toEqual(['query-1', 'query-2'])
  })

  it('only leaves the active query tab AiPanel visible', () => {
    renderWorkspaceBody('query-1')
    const hosts = screen.getAllByTestId('workspace-ai-panel-host')
    expect(hosts[0]).not.toHaveStyle({ visibility: 'hidden' })
    expect(hosts[0]).toHaveAttribute('aria-hidden', 'false')
    expect(hosts[1]).toHaveStyle({ visibility: 'hidden' })
    expect(hosts[1]).toHaveStyle({ pointerEvents: 'none' })
    expect(hosts[1]).toHaveAttribute('aria-hidden', 'true')
  })

  it('keeps query AiPanel instances mounted after switching to a non-query tab', () => {
    const { rerender } = renderWorkspaceBody('query-1')

    rerender(
      <WorkspaceBody
        tabs={[queryTabOne, queryTabTwo, tableTab]}
        activeTabId="table-1"
        connectionId="conn-1"
        renderTabStack={() => <div data-testid="tab-stack-slot">tab stack</div>}
      />
    )

    expect(screen.getAllByTestId('mock-ai-panel')).toHaveLength(2)
    for (const host of screen.getAllByTestId('workspace-ai-panel-host')) {
      expect(host).toHaveStyle({ visibility: 'hidden' })
      expect(host).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('collapses on a non-query tab without mutating stored AiPanel preference', () => {
    renderWorkspaceBody('table-1')
    expect(panelRef.current.collapse).toHaveBeenCalled()
    expect(useAiStore.getState().tabs['query-1']?.isPanelOpen).toBe(true)
  })

  it('dispatches a workspace layout resize event on panel resize', () => {
    const listener = vi.fn()
    window.addEventListener(WORKSPACE_LAYOUT_EVENT, listener)
    try {
      renderWorkspaceBody('query-1')
      const onResize = panelRenders.find((props) => props.onResize)?.onResize as
        | (() => void)
        | undefined
      onResize?.()
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(WORKSPACE_LAYOUT_EVENT, listener)
    }
  })
})
