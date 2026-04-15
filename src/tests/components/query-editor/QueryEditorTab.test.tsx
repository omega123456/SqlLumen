import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { QueryEditorTab } from '../../../components/query-editor/QueryEditorTab'
import { useQueryStore } from '../../../stores/query-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useAiStore } from '../../../stores/ai-store'
import {
  useWorkspaceStore,
  _resetTabIdCounter,
  _resetQueryTabCounter,
} from '../../../stores/workspace-store'
import type { QueryEditorTab as QueryEditorTabType } from '../../../types/schema'

// Mock tauri dialog (EditorToolbar depends on it)
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(() => Promise.resolve(null)),
  open: vi.fn(() => Promise.resolve(null)),
}))

function emptyAiTabState(overrides: Partial<import('../../../stores/ai-store').TabAiState> = {}) {
  return {
    messages: [],
    isGenerating: false,
    activeStreamId: null,
    attachedContext: null,
    isPanelOpen: false,
    error: null,
    retrievedSchemaDdl: '',
    lastRetrievalTimestamp: 0,
    isWaitingForIndex: false,
    connectionId: null,
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

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  useWorkspaceStore.setState({ tabsByConnection: {}, activeTabByConnection: {} })
  useAiStore.setState({ tabs: {} })
  _resetTabIdCounter()
  _resetQueryTabCounter()
  mockIPC(() => null)
  // Default AI to disabled
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'false' },
  })
})

describe('QueryEditorTab', () => {
  it('renders with data-testid', () => {
    render(<QueryEditorTab tab={mockTab} />)
    expect(screen.getByTestId('query-editor-tab')).toBeInTheDocument()
  })

  it('renders the editor toolbar', () => {
    render(<QueryEditorTab tab={mockTab} />)
    expect(screen.getByTestId('editor-toolbar')).toBeInTheDocument()
  })

  it('renders Monaco editor wrapper', () => {
    render(<QueryEditorTab tab={mockTab} />)
    expect(screen.getByTestId('monaco-editor-wrapper')).toBeInTheDocument()
  })

  it('renders result panel when no query has been run', () => {
    render(<QueryEditorTab tab={mockTab} />)
    expect(screen.getByTestId('result-panel')).toBeInTheDocument()
    expect(screen.getByText('Run a query to see results')).toBeInTheDocument()
  })

  it('passes tab connectionId to toolbar', () => {
    render(<QueryEditorTab tab={mockTab} />)
    // The toolbar receives connectionId prop — verify it renders with the correct buttons
    // Execute Query button was removed — execution is via CodeLens
    expect(screen.queryByTestId('toolbar-execute')).not.toBeInTheDocument()
    expect(screen.getByTestId('toolbar-execute-all')).toBeInTheDocument()
  })

  it('renders with different tab', () => {
    const tab2: QueryEditorTabType = {
      id: 'tab-2',
      type: 'query-editor',
      label: 'Query 2',
      connectionId: 'conn-2',
    }
    render(<QueryEditorTab tab={tab2} />)
    expect(screen.getByTestId('query-editor-tab')).toBeInTheDocument()
  })

  it('shows execute-all button disabled when no content', () => {
    render(<QueryEditorTab tab={mockTab} />)
    expect(screen.getByTestId('toolbar-execute-all')).toBeDisabled()
  })

  it('does not render AI panel when ai.enabled is false', () => {
    render(<QueryEditorTab tab={mockTab} />)
    expect(screen.queryByTestId('ai-panel')).not.toBeInTheDocument()
  })

  it('renders AI panel when ai.enabled is true and panel is open', () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'true' },
    })
    useAiStore.setState({
      tabs: { 'tab-1': emptyAiTabState({ isPanelOpen: true }) },
    })
    render(<QueryEditorTab tab={mockTab} />)
    expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
  })

  it('does not show AI toggle button when ai.enabled is false', () => {
    render(<QueryEditorTab tab={mockTab} />)
    expect(screen.queryByTestId('toolbar-ai-toggle')).not.toBeInTheDocument()
  })

  it('renders AI panel component even when panel is collapsed (ai enabled)', () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'true' },
    })
    useAiStore.setState({
      tabs: { 'tab-1': emptyAiTabState({ isPanelOpen: false }) },
    })
    render(<QueryEditorTab tab={mockTab} />)
    // The AiPanel component is still in the DOM (collapsible, not removed)
    expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
  })

  it('shows AI toggle button when ai.enabled is true', () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'true' },
    })
    render(<QueryEditorTab tab={mockTab} />)
    expect(screen.getByTestId('toolbar-ai-toggle')).toBeInTheDocument()
  })

  it('still renders editor and result panel when AI is enabled', () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'true' },
    })
    useAiStore.setState({
      tabs: { 'tab-1': emptyAiTabState({ isPanelOpen: true }) },
    })
    render(<QueryEditorTab tab={mockTab} />)
    expect(screen.getByTestId('monaco-editor-wrapper')).toBeInTheDocument()
    expect(screen.getByTestId('result-panel')).toBeInTheDocument()
  })
})
