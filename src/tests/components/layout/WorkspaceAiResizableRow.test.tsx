import type { ReactElement } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { WORKSPACE_LAYOUT_EVENT } from '../../../lib/workspace-layout-events'
import { WorkspaceAiResizableRow } from '../../../components/layout/WorkspaceAiResizableRow'
import { AiDiffBridgeProvider } from '../../../components/query-editor/ai-diff-bridge-context'
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../../stores/settings-store'
import { useAiStore } from '../../../stores/ai-store'
import type { TabAiState } from '../../../stores/ai-store'
import type { QueryEditorTab as QueryEditorTabType } from '../../../types/schema'

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
        { 'data-testid': props.className as string | undefined },
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

const mockTab: QueryEditorTabType = {
  id: 'tab-1',
  type: 'query-editor',
  label: 'Query 1',
  connectionId: 'conn-1',
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

function setupMockIPC() {
  mockIPC((cmd) => {
    if (cmd === 'log_frontend') {
      return undefined
    }
    if (cmd === 'plugin:event|listen') {
      return () => {}
    }
    if (cmd === 'plugin:event|unlisten') {
      return undefined
    }
    if (cmd === 'get_setting') {
      return null
    }
    if (cmd === 'set_setting') {
      return undefined
    }
    if (cmd === 'get_all_settings') {
      return {}
    }
    if (cmd === 'ai_chat') {
      return undefined
    }
    if (cmd === 'ai_cancel') {
      return undefined
    }
    if (cmd === 'ai_query_expand') {
      return { text: '{"queries":["q1","q2","q3"]}' }
    }
    if (cmd === 'semantic_search') {
      return []
    }
    if (cmd === 'build_schema_index') {
      return undefined
    }
    if (cmd === 'get_index_status') {
      return { status: 'ready' }
    }
    if (cmd === 'invalidate_schema_index') {
      return undefined
    }
    if (cmd === 'list_indexed_tables') {
      return []
    }
    if (cmd === 'fetch_schema_metadata') {
      return {
        databases: ['testdb'],
        tables: {
          testdb: [
            { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 10, dataSize: 1024 },
          ],
        },
        columns: {
          'testdb.users': [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR(255)' },
          ],
        },
        routines: {},
      }
    }
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
  })
}

function renderWithBridge(ui: ReactElement) {
  return render(<AiDiffBridgeProvider>{ui}</AiDiffBridgeProvider>)
}

beforeEach(() => {
  setupMockIPC()
  panelRenders.length = 0
  panelState.collapsed = false
  panelRef.current.expand.mockClear()
  panelRef.current.collapse.mockClear()
  panelRef.current.isCollapsed.mockClear()
  useAiStore.setState({ tabs: {} })
  useSettingsStore.setState({
    settings: {
      ...SETTINGS_DEFAULTS,
      'ai.enabled': 'true',
      'ai.embeddingModel': 'nomic-embed-text',
    },
    pendingChanges: {},
    isDirty: false,
    isLoading: false,
    activeSection: 'ai',
    isDialogOpen: false,
    dialogSection: undefined,
  })
})

describe('WorkspaceAiResizableRow', () => {
  it('shows AiPanel when the store panel is open', () => {
    useAiStore.setState({
      tabs: { 'tab-1': emptyAiTabState({ isPanelOpen: true }) },
    })
    renderWithBridge(
      <WorkspaceAiResizableRow tab={mockTab}>
        <div data-testid="workspace-child">content</div>
      </WorkspaceAiResizableRow>
    )
    expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-child')).toBeInTheDocument()
  })

  it('closes the panel when the header close button is clicked', async () => {
    const user = userEvent.setup()
    useAiStore.setState({
      tabs: { 'tab-1': emptyAiTabState({ isPanelOpen: true }) },
    })
    renderWithBridge(
      <WorkspaceAiResizableRow tab={mockTab}>
        <div>content</div>
      </WorkspaceAiResizableRow>
    )
    await user.click(screen.getByTestId('ai-close-button'))
    expect(useAiStore.getState().tabs['tab-1']?.isPanelOpen).toBe(false)
  })

  it('expands and collapses the resizable panel when AI open state changes', () => {
    const { rerender } = renderWithBridge(
      <WorkspaceAiResizableRow tab={mockTab}>
        <div>content</div>
      </WorkspaceAiResizableRow>
    )

    expect(panelRef.current.collapse).toHaveBeenCalled()

    act(() => {
      useAiStore.setState({
        tabs: { 'tab-1': emptyAiTabState({ isPanelOpen: true }) },
      })
    })

    rerender(
      <AiDiffBridgeProvider>
        <WorkspaceAiResizableRow tab={mockTab}>
          <div>content</div>
        </WorkspaceAiResizableRow>
      </AiDiffBridgeProvider>
    )

    expect(panelRef.current.expand).toHaveBeenCalled()
  })

  it('dispatches a workspace layout event when panels resize', () => {
    const listener = vi.fn()
    window.addEventListener(WORKSPACE_LAYOUT_EVENT, listener)

    renderWithBridge(
      <WorkspaceAiResizableRow tab={mockTab}>
        <div>content</div>
      </WorkspaceAiResizableRow>
    )

    act(() => {
      ;(panelRenders[0].onResize as () => void)()
    })

    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(WORKSPACE_LAYOUT_EVENT, listener)
  })

  it('syncs store state when the AI panel resize handler collapses or expands the panel', () => {
    renderWithBridge(
      <WorkspaceAiResizableRow tab={mockTab}>
        <div>content</div>
      </WorkspaceAiResizableRow>
    )

    panelState.collapsed = false
    act(() => {
      ;(panelRenders[1].onResize as () => void)()
    })
    expect(useAiStore.getState().tabs['tab-1']?.isPanelOpen).toBe(true)

    panelState.collapsed = true
    act(() => {
      ;(panelRenders[1].onResize as () => void)()
    })
    expect(useAiStore.getState().tabs['tab-1']?.isPanelOpen).toBe(false)
  })
})
