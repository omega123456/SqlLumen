/**
 * Tests for the diff overlay flow in QueryEditorTab — triggering diff,
 * accepting, rejecting, and stale-range validation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { QueryEditorTab } from '../../../components/query-editor/QueryEditorTab'
import { AiDiffBridgeProvider } from '../../../components/query-editor/ai-diff-bridge-context'
import { WorkspaceAiResizableRow } from '../../../components/layout/WorkspaceAiResizableRow'
import { useQueryStore } from '../../../stores/query-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useAiStore } from '../../../stores/ai-store'
import type { TabAiState } from '../../../stores/ai-store'
import {
  useWorkspaceStore,
  _resetTabIdCounter,
  _resetQueryTabCounter,
} from '../../../stores/workspace-store'
import { useToastStore } from '../../../stores/toast-store'
import type { QueryEditorTab as QueryEditorTabType } from '../../../types/schema'

// Mock tauri dialog (EditorToolbar depends on it)
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(() => Promise.resolve(null)),
  open: vi.fn(() => Promise.resolve(null)),
}))

function emptyAiTabState(overrides: Partial<TabAiState> = {}): TabAiState {
  return {
    messages: [],
    isGenerating: false,
    activeStreamId: null,
    attachedContext: null,
    isPanelOpen: true,
    error: null,
    retrievedSchemaDdl: '',
    lastRetrievalTimestamp: 0,
    isWaitingForIndex: false,
    connectionId: 'conn-1',
    _unlisten: null,
    ...overrides,
  }
}

const mockTab: QueryEditorTabType = {
  id: 'tab-1',
  type: 'query-editor',
  label: 'Query 1',
  connectionId: 'conn-1',
}

function renderQueryTabWithAiWorkspace() {
  return render(
    <AiDiffBridgeProvider>
      <div style={{ height: 400, minHeight: 0 }}>
        <WorkspaceAiResizableRow tab={mockTab}>
          <QueryEditorTab tab={mockTab} />
        </WorkspaceAiResizableRow>
      </div>
    </AiDiffBridgeProvider>
  )
}

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  useQueryStore.setState({ tabs: {} })
  useWorkspaceStore.setState({ tabsByConnection: {}, activeTabByConnection: {} })
  useAiStore.setState({ tabs: {} })
  useToastStore.setState({ toasts: [] })
  _resetTabIdCounter()
  _resetQueryTabCounter()
  mockIPC(() => null)
  // Enable AI
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'true' },
  })
})

afterEach(() => {
  consoleSpy.mockRestore()
})

describe('QueryEditorTab — diff overlay', () => {
  it('does not render diff overlay by default', () => {
    useAiStore.setState({
      tabs: { 'tab-1': emptyAiTabState() },
    })
    render(<QueryEditorTab tab={mockTab} />)
    expect(screen.queryByTestId('diff-overlay')).not.toBeInTheDocument()
  })

  it('renders AI panel with proper testid when AI is enabled and panel is open', () => {
    useAiStore.setState({
      tabs: { 'tab-1': emptyAiTabState({ isPanelOpen: true }) },
    })
    renderQueryTabWithAiWorkspace()
    expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
  })

  it('does not show diff overlay when AI is disabled', () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'false' },
    })
    render(<QueryEditorTab tab={mockTab} />)
    expect(screen.queryByTestId('diff-overlay')).not.toBeInTheDocument()
  })

  it('editor area renders alongside AI panel and result panel', () => {
    useAiStore.setState({
      tabs: { 'tab-1': emptyAiTabState() },
    })
    renderQueryTabWithAiWorkspace()
    expect(screen.getByTestId('query-editor-tab')).toBeInTheDocument()
    expect(screen.getByTestId('monaco-editor-wrapper')).toBeInTheDocument()
    expect(screen.getByTestId('result-panel')).toBeInTheDocument()
    expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
  })
})
