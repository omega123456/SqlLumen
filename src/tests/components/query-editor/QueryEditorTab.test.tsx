import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { QueryEditorTab } from '../../../components/query-editor/QueryEditorTab'
import { useQueryStore } from '../../../stores/query-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useAiStore } from '../../../stores/ai-store'
import { resetWorkspaceStore } from '../../helpers/workspace-test-utils'
import type { QueryEditorTab as QueryEditorTabType } from '../../../types/schema'
import { makeAiTabState } from '../../helpers/ai-test-utils'
import { AiDiffBridgeProvider } from '../../../components/query-editor/ai-diff-bridge-context'
import { WorkspaceBody } from '../../../components/layout/WorkspaceBody'
import { useToastStore } from '../../../stores/toast-store'
import * as SchemaMetadataCacheModule from '../../../components/query-editor/schema-metadata-cache'
import * as CompletionServiceModule from '../../../components/query-editor/completion-service'
import * as MonacoEditorReactModule from '@monaco-editor/react'
import React from 'react'

// IPC fixtures in setup.ts handle plugin:dialog|save and plugin:dialog|open (return null = cancelled)

const emptyAiTabState = makeAiTabState

const mockTab: QueryEditorTabType = {
  id: 'tab-1',
  type: 'query-editor',
  label: 'Query 1',
  connectionId: 'conn-1',
}

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  resetWorkspaceStore()
  useAiStore.setState({ tabs: {} })
  // Default AI to disabled
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'false' },
  })
})

describe('QueryEditorTab', () => {
  it('renders the toolbar, the Monaco editor and the empty result panel for a fresh tab', async () => {
    render(<QueryEditorTab tab={mockTab} />)

    expect(screen.getByTestId('query-editor-tab')).toBeInTheDocument()
    expect(screen.getByTestId('editor-toolbar')).toBeInTheDocument()
    expect(await screen.findByTestId('monaco-editor-wrapper')).toBeInTheDocument()
    expect(screen.getByTestId('result-panel')).toBeInTheDocument()
    expect(screen.getByText('Run a query to see results')).toBeInTheDocument()
    expect(screen.queryByTestId('toolbar-execute')).not.toBeInTheDocument()
    expect(screen.getByTestId('toolbar-execute-all')).toBeDisabled()
  })

  it('does not render AI panel inside the query tab tree', () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'true' },
    })
    useAiStore.setState({
      tabs: { 'tab-1': emptyAiTabState({ isPanelOpen: true }) },
    })
    render(<QueryEditorTab tab={mockTab} />)
    expect(screen.queryByTestId('ai-panel')).not.toBeInTheDocument()
  })

  it('does not show AI toggle on the editor toolbar when ai.enabled is true', () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'true' },
    })
    render(<QueryEditorTab tab={mockTab} />)
    expect(screen.queryByTestId('toolbar-ai-toggle')).not.toBeInTheDocument()
  })
})

describe('diff overlay and AI panel', () => {
  /**
   * Tests for the diff overlay flow in QueryEditorTab — triggering diff,
   * accepting, rejecting, and stale-range validation.
   */

  // IPC fixtures in setup.ts handle plugin:dialog|save and plugin:dialog|open (return null = cancelled)

  /** Convenience: diff tests render with the panel open and a specific connectionId. */
  function emptyAiTabState(overrides?: Parameters<typeof makeAiTabState>[0]) {
    return makeAiTabState({ isPanelOpen: true, connectionId: 'conn-1', ...overrides })
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
          <WorkspaceBody
            tabs={[mockTab]}
            activeTabId={mockTab.id}
            connectionId={mockTab.connectionId}
            renderTabStack={() => <QueryEditorTab tab={mockTab} />}
          />
        </div>
      </AiDiffBridgeProvider>
    )
  }

  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    useQueryStore.setState({ tabs: {} })
    resetWorkspaceStore()
    useAiStore.setState({ tabs: {} })
    useToastStore.setState({ toasts: [] })
    // Enable AI
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'true' },
    })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  describe('QueryEditorTab — diff overlay', () => {
    it('editor area renders alongside AI panel and result panel', async () => {
      useAiStore.setState({
        tabs: { 'tab-1': emptyAiTabState() },
      })
      renderQueryTabWithAiWorkspace()
      expect(screen.getByTestId('query-editor-tab')).toBeInTheDocument()
      expect(await screen.findByTestId('monaco-editor-wrapper')).toBeInTheDocument()
      expect(screen.getByTestId('result-panel')).toBeInTheDocument()
      expect(await screen.findByTestId('ai-panel')).toBeInTheDocument()
    })
  })
})

describe('editor focus on mount', () => {
  /**
   * Test: editor.focus() should be called when MonacoEditorWrapper mounts
   * in a new query tab so the user can immediately start typing.
   */

  // Mock editor with focus spy
  const mockFocus = vi.fn()

  const mockEditorInstance = {
    focus: mockFocus,
    layout: vi.fn(),
    onDidChangeCursorPosition: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeCursorSelection: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDispose: vi.fn(),
    getContainerDomNode: () => document.createElement('div'),
    getModel: vi.fn(() => ({
      uri: { toString: () => 'inmemory://model/1' },
      getVersionId: () => 1,
      getValueInRange: vi.fn(() => ''),
    })),
    getSelection: vi.fn(() => ({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
    })),
    setPosition: vi.fn(),
    revealPositionInCenter: vi.fn(),
    getPosition: vi.fn(() => ({ lineNumber: 1, column: 1 })),
    addCommand: vi.fn(),
    addAction: vi.fn(() => ({ dispose: vi.fn() })),
    updateOptions: vi.fn(),
  }

  function createRichMonacoEditorMock() {
    return (props: Record<string, unknown>) => {
      function MockEditor() {
        React.useEffect(() => {
          const onMount = props.onMount as
            | ((editor: typeof mockEditorInstance, monaco: Record<string, unknown>) => void)
            | undefined
          onMount?.(mockEditorInstance, {
            editor: { defineTheme: vi.fn(), setTheme: vi.fn() },
            languages: {},
            KeyCode: { F9: 78, F12: 81 },
            KeyMod: { CtrlCmd: 2048, Shift: 1024, Alt: 512 },
          })
        }, [])

        return React.createElement('textarea', {
          'data-testid': 'monaco-editor',
          value: (props.value as string) ?? '',
          readOnly: true,
        })
      }
      return React.createElement(MockEditor)
    }
  }

  const mockTab: QueryEditorTabType = {
    id: 'tab-focus-1',
    type: 'query-editor',
    label: 'Query 1',
    connectionId: 'conn-1',
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    mockFocus.mockClear()
    mockEditorInstance.layout.mockClear()
    mockEditorInstance.onDidChangeCursorPosition.mockClear()
    mockEditorInstance.onDidChangeCursorSelection.mockClear()
    mockEditorInstance.onDidChangeModelContent.mockClear()
    mockEditorInstance.onDidDispose.mockClear()
    mockEditorInstance.getModel.mockClear()
    mockEditorInstance.getSelection.mockClear()
    mockEditorInstance.setPosition.mockClear()
    mockEditorInstance.revealPositionInCenter.mockClear()
    mockEditorInstance.addCommand.mockClear()
    mockEditorInstance.updateOptions.mockClear()

    useQueryStore.setState({ tabs: {} })
    resetWorkspaceStore()
    useAiStore.setState({ tabs: {} })
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'false' },
    })

    // Override @monaco-editor/react with richer mock that calls onMount
    vi.spyOn(MonacoEditorReactModule, 'default').mockImplementation(createRichMonacoEditorMock())

    // Spy on schema-metadata-cache
    vi.spyOn(SchemaMetadataCacheModule, 'loadCache').mockResolvedValue(undefined)
    vi.spyOn(SchemaMetadataCacheModule, 'getCache').mockReturnValue({
      status: 'empty',
      databases: [],
      tables: {},
      views: {},
      columns: {},
      routines: {},
      triggers: {},
      foreignKeys: {},
      indexes: {},
    })
    vi.spyOn(SchemaMetadataCacheModule, 'getPendingLoad').mockReturnValue(null)

    // Spy on completion-service
    vi.spyOn(CompletionServiceModule, 'registerModelConnection')
    vi.spyOn(CompletionServiceModule, 'unregisterModelConnection')
    vi.spyOn(CompletionServiceModule, 'resetModelConnections')

    // react-resizable-panels renders real panels (ResizeObserver polyfilled in setup.ts).
  })

  describe('QueryEditorTab - editor focus on mount', () => {
    it('calls editor.focus() when the Monaco editor mounts in a new query tab', async () => {
      render(<QueryEditorTab tab={mockTab} />)

      await waitFor(() => {
        expect(mockFocus).toHaveBeenCalled()
      })
    })
  })
})

describe('AI sidebar open state (Monaco layout)', () => {
  // ---------------------------------------------------------------------------
  // Mock editor instance with layout() spy
  // ---------------------------------------------------------------------------
  const mockLayout = vi.fn()

  const mockEditorInstance = {
    layout: mockLayout,
    onDidChangeCursorPosition: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeCursorSelection: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDispose: vi.fn(),
    getContainerDomNode: () => document.createElement('div'),
    getModel: vi.fn(() => ({
      uri: { toString: () => 'inmemory://model/1' },
      getVersionId: () => 1,
      getValueInRange: vi.fn(() => ''),
    })),
    getSelection: vi.fn(() => ({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
    })),
    setPosition: vi.fn(),
    revealPositionInCenter: vi.fn(),
    getPosition: vi.fn(() => ({ lineNumber: 1, column: 1 })),
    addCommand: vi.fn(),
    addAction: vi.fn(() => ({ dispose: vi.fn() })),
    updateOptions: vi.fn(),
    focus: vi.fn(),
  }

  function createRichMonacoEditorMock() {
    return (props: Record<string, unknown>) => {
      function MockEditor() {
        React.useEffect(() => {
          const onMount = props.onMount as
            | ((editor: typeof mockEditorInstance, monaco: Record<string, unknown>) => void)
            | undefined
          onMount?.(mockEditorInstance, {
            editor: { defineTheme: vi.fn(), setTheme: vi.fn() },
            languages: {},
            KeyCode: { F9: 78, F12: 81 },
            KeyMod: { CtrlCmd: 2048, Shift: 1024, Alt: 512 },
          })
        }, [])

        return React.createElement('textarea', {
          'data-testid': 'monaco-editor',
          value: (props.value as string) ?? '',
          onChange: (e: { target: { value: string } }) => {
            const fn = props.onChange as ((v: string | undefined) => void) | undefined
            fn?.(e.target.value)
          },
        })
      }
      return React.createElement(MockEditor)
    }
  }

  const mockTab: QueryEditorTabType = {
    id: 'tab-1',
    type: 'query-editor',
    label: 'Query 1',
    connectionId: 'conn-1',
  }

  const emptyAiTabState = makeAiTabState

  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    useQueryStore.setState({ tabs: {} })
    resetWorkspaceStore()
    useAiStore.setState({ tabs: {} })
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'false' },
    })
    mockLayout.mockClear()
    mockEditorInstance.onDidChangeCursorPosition.mockClear()
    mockEditorInstance.onDidChangeCursorSelection.mockClear()
    mockEditorInstance.onDidDispose.mockClear()
    mockEditorInstance.getModel.mockClear()
    mockEditorInstance.getSelection.mockClear()
    mockEditorInstance.setPosition.mockClear()
    mockEditorInstance.revealPositionInCenter.mockClear()
    mockEditorInstance.addCommand.mockClear()
    mockEditorInstance.focus.mockClear()
    mockEditorInstance.updateOptions.mockClear()
    mockEditorInstance.onDidChangeModelContent.mockClear()

    // Override @monaco-editor/react with richer mock that calls onMount
    vi.spyOn(MonacoEditorReactModule, 'default').mockImplementation(createRichMonacoEditorMock())

    // Spy on schema-metadata-cache
    vi.spyOn(SchemaMetadataCacheModule, 'loadCache').mockResolvedValue(undefined)
    vi.spyOn(SchemaMetadataCacheModule, 'getCache').mockReturnValue({
      status: 'empty',
      databases: [],
      tables: {},
      views: {},
      columns: {},
      routines: {},
      triggers: {},
      foreignKeys: {},
      indexes: {},
    })
    vi.spyOn(SchemaMetadataCacheModule, 'getPendingLoad').mockReturnValue(null)

    // Spy on completion-service
    vi.spyOn(CompletionServiceModule, 'registerModelConnection')
    vi.spyOn(CompletionServiceModule, 'unregisterModelConnection')
    vi.spyOn(CompletionServiceModule, 'resetModelConnections')

    // react-resizable-panels renders real panels (ResizeObserver polyfilled in setup.ts).
    // The onResize-based tests below verify editor.layout() is called via the AI panel state change.
  })

  describe('QueryEditorTab — AI sidebar open state (Monaco layout)', () => {
    beforeEach(() => {
      useSettingsStore.setState({
        settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'true' },
      })
    })

    it('calls editor.layout() when isPanelOpen toggles in the AI store', async () => {
      useAiStore.setState({
        tabs: { 'tab-1': emptyAiTabState({ isPanelOpen: false }) },
      })
      render(<QueryEditorTab tab={mockTab} />)

      // Wait for the lazy-loaded MonacoEditorWrapper to mount and fire onMount
      await waitFor(() => {
        expect(screen.getByTestId('monaco-editor')).toBeInTheDocument()
      })
      mockLayout.mockClear()

      act(() => {
        useAiStore.setState({
          tabs: { 'tab-1': emptyAiTabState({ isPanelOpen: true }) },
        })
      })

      await waitFor(() => {
        expect(mockLayout).toHaveBeenCalled()
      })
    })
  })
})
