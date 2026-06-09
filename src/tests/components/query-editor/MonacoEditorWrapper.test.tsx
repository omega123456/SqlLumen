import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MonacoEditorWrapper } from '../../../components/query-editor/MonacoEditorWrapper'
import { useQueryStore } from '../../../stores/query-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useAiStore } from '../../../stores/ai-store'
import { useFavoritesStore } from '../../../stores/favorites-store'
import { DEFAULT_SHORTCUTS, useShortcutStore } from '../../../stores/shortcut-store'
import * as SchemaMetadataCacheModule from '../../../components/query-editor/schema-metadata-cache'
import * as CodeLensProviderModule from '../../../components/query-editor/codelens-provider'
import * as CompletionServiceModule from '../../../components/query-editor/completion-service'
import * as MonacoEditorReactModule from '@monaco-editor/react'

// Use vi.spyOn to install per-test mock implementations without vi.mock().
// Monaco, monaco-sql-languages, and monaco-sql-languages/esm are globally mocked in setup.ts.
// mysql-language-setup and signature-help-provider are side-effect-only imports whose
// side effects call already-globally-mocked Monaco APIs (safe without mocking).

// Override the useMonaco mock to return a functional Monaco instance
const mockSetTheme = vi.fn()
const mockDefineTheme = vi.fn()
const mockCursorPositionDispose = vi.fn()
const mockOnDidDispose = vi.fn()
const registeredDisposeHandlers: Array<() => void> = []
const mockModelUri = { toString: () => 'inmemory://model/1' }
const mockContentChangeDispose = vi.fn()
const mockSelectionDispose = vi.fn()
let capturedContentChangeHandler: (() => void) | null = null
let capturedSelectionChangeHandler:
  | ((e: {
      selection: {
        startLineNumber: number
        startColumn: number
        endLineNumber: number
        endColumn: number
      }
    }) => void)
  | null = null
const capturedAddCommandHandlers: Record<number, () => void> = {}
const capturedActions: Record<string, { id: string; run: (ed: unknown) => void }> = {}

function createMockModel(selectedText = '') {
  return {
    uri: mockModelUri,
    getValue: () => 'SELECT 1',
    getValueInRange: () => selectedText,
    getLineCount: () => 1,
    getLineLength: () => 8,
  }
}

const mockEditorInstance = {
  setPosition: vi.fn(),
  revealPositionInCenter: vi.fn(),
  getSelection: vi.fn(() => ({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 1,
  })),
  onDidChangeCursorPosition: vi.fn(() => ({ dispose: mockCursorPositionDispose })),
  onDidChangeCursorSelection: vi.fn(
    (
      handler: (e: {
        selection: {
          startLineNumber: number
          startColumn: number
          endLineNumber: number
          endColumn: number
        }
      }) => void
    ) => {
      capturedSelectionChangeHandler = handler
      return { dispose: mockSelectionDispose }
    }
  ),
  onDidChangeModelContent: vi.fn((handler: () => void) => {
    capturedContentChangeHandler = handler
    return { dispose: mockContentChangeDispose }
  }),
  onDidDispose: vi.fn((handler: () => void) => {
    mockOnDidDispose(handler)
    registeredDisposeHandlers.push(handler)
  }),
  getModel: vi.fn(() => createMockModel()),
  addCommand: vi.fn((keyCode: number, handler: () => void) => {
    capturedAddCommandHandlers[keyCode] = handler
  }),
  addAction: vi.fn((action: { id: string; run: (ed: unknown) => void }) => {
    capturedActions[action.id] = action
    return { dispose: vi.fn() }
  }),
  getPosition: vi.fn(() => ({ lineNumber: 1, column: 1 })),
  updateOptions: vi.fn(),
}

// Track props passed to the mock Editor component
const mockEditorComponent = vi.fn()

import React from 'react'

function createRichMonacoEditorMock() {
  return (props: Record<string, unknown>) => {
    mockEditorComponent(props)
    function MockEditor() {
      React.useEffect(() => {
        const onMount = props.onMount as
          | ((editor: typeof mockEditorInstance, monaco: Record<string, unknown>) => void)
          | undefined
        onMount?.(mockEditorInstance, {
          editor: {
            defineTheme: mockDefineTheme,
            setTheme: mockSetTheme,
          },
          languages: {},
          KeyCode: { F9: 78, F12: 81, KeyT: 52, KeyN: 49, Enter: 3, Tab: 2, Comma: 6 },
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

beforeEach(() => {
  vi.clearAllMocks()
  useQueryStore.setState({ tabs: {} })
  useShortcutStore.setState({
    shortcuts: { ...DEFAULT_SHORTCUTS },
    recordingActionId: null,
    conflictActionId: null,
    _pendingBinding: null,
    _pendingActionId: null,
    _actions: {},
  })
  // Reset AI store tabs to prevent state leaking between tests
  useAiStore.setState({ tabs: {} })
  // Reset settings store to defaults (no loaded settings)
  useSettingsStore.setState({ settings: {}, pendingChanges: {}, isDirty: false })
  mockSetTheme.mockClear()
  mockDefineTheme.mockClear()
  mockCursorPositionDispose.mockClear()
  mockOnDidDispose.mockClear()
  mockEditorInstance.setPosition.mockClear()
  mockEditorInstance.revealPositionInCenter.mockClear()
  mockEditorInstance.onDidChangeCursorPosition.mockClear()
  mockEditorInstance.onDidChangeCursorSelection.mockClear()
  mockEditorInstance.onDidDispose.mockClear()
  mockEditorInstance.getModel.mockClear()
  mockEditorInstance.getSelection.mockClear()
  mockEditorInstance.addCommand.mockClear()
  mockEditorInstance.updateOptions.mockClear()
  mockEditorInstance.onDidChangeModelContent.mockClear()
  mockContentChangeDispose.mockClear()
  mockSelectionDispose.mockClear()
  mockEditorComponent.mockClear()
  capturedContentChangeHandler = null
  capturedSelectionChangeHandler = null
  Object.keys(capturedAddCommandHandlers).forEach(
    (k) => delete capturedAddCommandHandlers[Number(k)]
  )
  Object.keys(capturedActions).forEach((k) => delete capturedActions[k])
  mockEditorInstance.addAction.mockClear()
  mockEditorInstance.getPosition.mockClear()
  mockEditorInstance.getPosition.mockImplementation(() => ({ lineNumber: 1, column: 1 }))
  registeredDisposeHandlers.length = 0
  // Reset getModel to its default implementation
  mockEditorInstance.getModel.mockImplementation(() => createMockModel())
  mockEditorInstance.getSelection.mockImplementation(() => ({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 1,
  }))

  // Override @monaco-editor/react default export with a richer mock that calls onMount
  vi.spyOn(MonacoEditorReactModule, 'default').mockImplementation(createRichMonacoEditorMock())

  // Spy on schema-metadata-cache — loadCache resolves immediately, getCache returns empty cache
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

  // Spy on codelens-provider — triggerCodeLensRefresh is used to verify calls
  vi.spyOn(CodeLensProviderModule, 'triggerCodeLensRefresh')

  // Spy on completion-service — track model connection registration
  vi.spyOn(CompletionServiceModule, 'registerModelConnection')
  vi.spyOn(CompletionServiceModule, 'unregisterModelConnection')
  vi.spyOn(CompletionServiceModule, 'getModelConnectionId').mockReturnValue(undefined)
  vi.spyOn(CompletionServiceModule, 'resetModelConnections')
})

// Convenience accessors for spy call tracking
function mockRegisterModelConnection() {
  return CompletionServiceModule.registerModelConnection as ReturnType<typeof vi.fn>
}
function mockUnregisterModelConnection() {
  return CompletionServiceModule.unregisterModelConnection as ReturnType<typeof vi.fn>
}
function mockTriggerCodeLensRefresh() {
  return CodeLensProviderModule.triggerCodeLensRefresh as ReturnType<typeof vi.fn>
}

describe('MonacoEditorWrapper', () => {
  it('renders the editor container', () => {
    render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
    expect(screen.getByTestId('monaco-editor-wrapper')).toBeInTheDocument()
  })

  it('renders with initial content from query store', () => {
    useQueryStore.getState().setContent('tab-1', 'SELECT 1 FROM t')
    render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
    const editor = screen.getByTestId('monaco-editor')
    expect(editor).toHaveValue('SELECT 1 FROM t')
  })

  it('renders with empty content when tab has no state', () => {
    render(<MonacoEditorWrapper tabId="tab-nonexistent" connectionId="conn-1" />)
    const editor = screen.getByTestId('monaco-editor')
    expect(editor).toHaveValue('')
  })

  it('registers Monaco themes when monaco is available', () => {
    render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
    // registerMonacoThemes should have been called via the effect
    expect(mockDefineTheme).toHaveBeenCalledWith('precision-studio-dark', expect.any(Object))
    expect(mockDefineTheme).toHaveBeenCalledWith('precision-studio-light', expect.any(Object))
  })

  it('sets Monaco theme based on current app theme', () => {
    render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
    // Should have called setTheme at least once via the effect
    expect(mockSetTheme).toHaveBeenCalled()
  })

  it('updates query store when editor content changes', () => {
    useQueryStore.getState().setContent('tab-1', '')
    render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
    const editor = screen.getByTestId('monaco-editor')
    fireEvent.change(editor, { target: { value: 'NEW CONTENT' } })
    expect(useQueryStore.getState().tabs['tab-1']?.content).toBe('NEW CONTENT')
  })

  it('calls onMount callback when provided', () => {
    const onMount = vi.fn()
    render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" onMount={onMount} />)
    expect(onMount).toHaveBeenCalledWith(mockEditorInstance)
  })

  it('registers model-connection mapping when connectionId is provided', () => {
    render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
    expect(mockRegisterModelConnection()).toHaveBeenCalledWith(
      'inmemory://model/1',
      'conn-1',
      'tab-1',
      'query-editor'
    )
  })

  it('does not register model-connection mapping when connectionId is not provided', () => {
    render(<MonacoEditorWrapper tabId="tab-1" />)
    expect(mockRegisterModelConnection()).not.toHaveBeenCalled()
  })

  it('unregisters model-connection mapping on editor dispose', () => {
    render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

    expect(mockOnDidDispose).toHaveBeenCalledTimes(1)
    const handleDispose = registeredDisposeHandlers[0]
    handleDispose()

    expect(mockUnregisterModelConnection()).toHaveBeenCalledWith('inmemory://model/1')
  })

  it('disposes the cursor listener when the editor is disposed', () => {
    render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

    expect(mockOnDidDispose).toHaveBeenCalledTimes(1)
    const handleDispose = registeredDisposeHandlers[0]
    handleDispose()

    expect(mockCursorPositionDispose).toHaveBeenCalledTimes(1)
  })

  it('registers one cursor listener per mount', () => {
    const firstRender = render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
    expect(mockEditorInstance.onDidChangeCursorPosition).toHaveBeenCalledTimes(1)

    firstRender.unmount()
    registeredDisposeHandlers[0]?.()

    render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

    expect(mockEditorInstance.onDidChangeCursorPosition).toHaveBeenCalledTimes(2)
    expect(mockCursorPositionDispose).toHaveBeenCalledTimes(1)
  })

  it('renders without connectionId (backward compat)', () => {
    render(<MonacoEditorWrapper tabId="tab-1" />)
    expect(screen.getByTestId('monaco-editor-wrapper')).toBeInTheDocument()
  })

  it('passes language="mysql" to the Editor component', () => {
    render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
    expect(mockEditorComponent).toHaveBeenCalled()
    const props = mockEditorComponent.mock.calls[0][0]
    expect(props.language).toBe('mysql')
  })

  it('enables fixedOverflowWidgets so suggest popup is not clipped by container', () => {
    render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
    const lastCall = mockEditorComponent.mock.calls[mockEditorComponent.mock.calls.length - 1]
    const props = lastCall[0]
    expect(props.options.fixedOverflowWidgets).toBe(true)
  })

  it('unregisters model-connection using captured URI even when getModel returns null on dispose', () => {
    render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

    // Verify initial registration used the correct URI
    expect(mockRegisterModelConnection()).toHaveBeenCalledWith(
      'inmemory://model/1',
      'conn-1',
      'tab-1',
      'query-editor'
    )

    // Simulate the model being disposed before our handler runs
    // (getModel returns null when Monaco has already cleaned up)
    mockEditorInstance.getModel.mockReturnValue(
      null as unknown as ReturnType<typeof mockEditorInstance.getModel>
    )

    // Trigger the dispose handler
    const handleDispose = registeredDisposeHandlers[0]
    handleDispose()

    // Should still unregister using the captured URI from mount time
    expect(mockUnregisterModelConnection()).toHaveBeenCalledWith('inmemory://model/1')
  })

  // -----------------------------------------------------------------------
  // Override prop tests (used by object-editor)
  // -----------------------------------------------------------------------

  describe('override props', () => {
    it('uses override value instead of query-store content when value prop is provided', () => {
      useQueryStore.getState().setContent('tab-1', 'store content')
      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" value="override content" />)
      const editor = screen.getByTestId('monaco-editor')
      expect(editor).toHaveValue('override content')
    })

    it('calls override onChange instead of query-store setContent', () => {
      const onChange = vi.fn()
      render(
        <MonacoEditorWrapper
          tabId="tab-1"
          connectionId="conn-1"
          value="initial"
          onChange={onChange}
        />
      )
      const editor = screen.getByTestId('monaco-editor')
      fireEvent.change(editor, { target: { value: 'new value' } })
      expect(onChange).toHaveBeenCalledWith('new value')
      // Query store should NOT have been updated
      expect(useQueryStore.getState().tabs['tab-1']?.content ?? '').toBe('')
    })

    it('skips cursor position restore when value prop is provided', () => {
      // Set a saved cursor position in query store
      useQueryStore.getState().setContent('tab-1', '')
      useQueryStore.getState().setCursorPosition('tab-1', { lineNumber: 5, column: 10 })

      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" value="override" />)

      // setPosition should NOT have been called because we're in override mode
      expect(mockEditorInstance.setPosition).not.toHaveBeenCalled()
    })

    it('skips cursor position tracking when value prop is provided', () => {
      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" value="override" />)

      // onDidChangeCursorPosition should NOT have been called in override mode
      expect(mockEditorInstance.onDidChangeCursorPosition).not.toHaveBeenCalled()
      expect(mockEditorInstance.onDidChangeCursorSelection).not.toHaveBeenCalled()
    })

    it('uses override readOnly prop instead of status-based computation', () => {
      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" readOnly={true} />)
      const lastCall = mockEditorComponent.mock.calls[mockEditorComponent.mock.calls.length - 1]
      const props = lastCall[0]
      expect(props.options.readOnly).toBe(true)
    })

    it('uses override readOnly=false even when status is running', () => {
      // Set status to running in query store
      useQueryStore.setState({
        tabs: {
          'tab-1': {
            ...useQueryStore.getState().getTabState('tab-1'),
            tabStatus: 'running',
          },
        },
      })

      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" readOnly={false} />)
      const lastCall = mockEditorComponent.mock.calls[mockEditorComponent.mock.calls.length - 1]
      const props = lastCall[0]
      expect(props.options.readOnly).toBe(false)
    })

    it('falls back to query-store content when value prop is not provided', () => {
      useQueryStore.getState().setContent('tab-1', 'store content')
      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
      const editor = screen.getByTestId('monaco-editor')
      expect(editor).toHaveValue('store content')
    })

    it('falls back to query-store setContent when onChange is not provided', () => {
      useQueryStore.getState().setContent('tab-1', '')
      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
      const editor = screen.getByTestId('monaco-editor')
      fireEvent.change(editor, { target: { value: 'NEW CONTENT' } })
      expect(useQueryStore.getState().tabs['tab-1']?.content).toBe('NEW CONTENT')
    })
  })

  // -----------------------------------------------------------------------
  // AI pending overlay tests
  // -----------------------------------------------------------------------

  describe('ai pending overlay', () => {
    it('shows ai-pending-overlay when status is ai-pending', () => {
      useQueryStore.setState({
        tabs: {
          'tab-1': {
            ...useQueryStore.getState().getTabState('tab-1'),
            tabStatus: 'ai-pending',
          },
        },
      })

      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
      expect(screen.getByTestId('ai-pending-overlay')).toBeInTheDocument()
    })

    it('shows ai-pending-overlay when status is ai-reviewing', () => {
      useQueryStore.setState({
        tabs: {
          'tab-1': {
            ...useQueryStore.getState().getTabState('tab-1'),
            tabStatus: 'ai-reviewing',
          },
        },
      })

      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
      expect(screen.getByTestId('ai-pending-overlay')).toBeInTheDocument()
    })

    it('does not show ai-pending-overlay when status is idle', () => {
      useQueryStore.setState({
        tabs: {
          'tab-1': {
            ...useQueryStore.getState().getTabState('tab-1'),
            tabStatus: 'idle',
          },
        },
      })

      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
      expect(screen.queryByTestId('ai-pending-overlay')).not.toBeInTheDocument()
    })

    it('does not show ai-pending-overlay when status is running', () => {
      useQueryStore.setState({
        tabs: {
          'tab-1': {
            ...useQueryStore.getState().getTabState('tab-1'),
            tabStatus: 'running',
          },
        },
      })

      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
      expect(screen.queryByTestId('ai-pending-overlay')).not.toBeInTheDocument()
    })

    it('does not show ai-pending-overlay when overrideReadOnly is set', () => {
      useQueryStore.setState({
        tabs: {
          'tab-1': {
            ...useQueryStore.getState().getTabState('tab-1'),
            tabStatus: 'ai-pending',
          },
        },
      })

      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" readOnly={true} />)
      expect(screen.queryByTestId('ai-pending-overlay')).not.toBeInTheDocument()
    })
  })

  // -----------------------------------------------------------------------
  // Settings integration tests
  // -----------------------------------------------------------------------

  describe('settings integration', () => {
    it('registers F9, F12, and CtrlCmd+T keybindings via addCommand on mount', () => {
      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
      expect(mockEditorInstance.addCommand).toHaveBeenCalledTimes(3)
      // F9 for execute-query
      expect(mockEditorInstance.addCommand).toHaveBeenCalledWith(78, expect.any(Function))
      // F12 for format-query
      expect(mockEditorInstance.addCommand).toHaveBeenCalledWith(81, expect.any(Function))
      // CtrlCmd+T for new-query-tab
      expect(mockEditorInstance.addCommand).toHaveBeenCalledWith(2100, expect.any(Function))
    })

    it('applies default editor settings to Monaco options', () => {
      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
      const lastCall = mockEditorComponent.mock.calls[mockEditorComponent.mock.calls.length - 1]
      const props = lastCall[0]
      // Default font family from SETTINGS_DEFAULTS is JetBrains Mono
      expect(props.options.fontFamily).toContain('JetBrains Mono')
      expect(props.options.fontSize).toBe(14)
    })

    it('applies custom editor settings from settings store', () => {
      useSettingsStore.setState({
        settings: {
          'editor.fontFamily': 'Fira Code',
          'editor.fontSize': '16',
          'editor.lineHeight': '2.0',
          'editor.wordWrap': 'true',
          'editor.minimap': 'true',
          'editor.lineNumbers': 'false',
        },
      })

      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
      const lastCall = mockEditorComponent.mock.calls[mockEditorComponent.mock.calls.length - 1]
      const props = lastCall[0]
      expect(props.options.fontFamily).toContain('Fira Code')
      expect(props.options.fontSize).toBe(16)
      expect(props.options.wordWrap).toBe('on')
      expect(props.options.minimap).toEqual({ enabled: true })
      expect(props.options.lineNumbers).toBe('off')
    })

    it('registers the current shortcut-store binding for new-query-tab', () => {
      useShortcutStore.setState({
        shortcuts: {
          ...DEFAULT_SHORTCUTS,
          'new-query-tab': { key: 'N', modifiers: ['ctrl', 'shift'] },
        },
      })

      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

      expect(mockEditorInstance.addCommand).toHaveBeenCalledWith(3121, expect.any(Function))
      expect(capturedAddCommandHandlers[3121]).toBeDefined()
      expect(capturedAddCommandHandlers[2100]).toBeUndefined()
    })

    it('re-registers Monaco shortcuts when shortcut settings change', () => {
      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
      expect(mockEditorInstance.addCommand).toHaveBeenCalledTimes(3)

      act(() => {
        useShortcutStore.setState({
          shortcuts: {
            ...DEFAULT_SHORTCUTS,
            'new-query-tab': { key: 'N', modifiers: ['ctrl', 'shift'] },
          },
        })
      })

      expect(mockEditorInstance.addCommand).toHaveBeenCalledTimes(6)
      expect(capturedAddCommandHandlers[3121]).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // onDidChangeModelContent callback tests
  // -----------------------------------------------------------------------

  describe('onDidChangeModelContent callback', () => {
    it('requests a CodeLens refresh when editor content changes', () => {
      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

      // The onDidChangeModelContent callback was captured during mount
      expect(capturedContentChangeHandler).not.toBeNull()
      capturedContentChangeHandler!()

      expect(mockTriggerCodeLensRefresh()).toHaveBeenCalledTimes(1)
    })

    it('does not rewrite unchanged selected text on plain typing', () => {
      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

      const beforeTabState = useQueryStore.getState().tabs['tab-1']
      act(() => {
        capturedContentChangeHandler!()
        capturedContentChangeHandler!()
      })

      expect(useQueryStore.getState().tabs['tab-1']).toBe(beforeTabState)
    })

    it('updates AI attached context when content changes and context exists', () => {
      // Set up AI store with attached context for this tab
      useAiStore.getState().setAttachedContext('tab-1', {
        sql: 'old content',
        range: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 12,
        },
      })

      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

      // Trigger the content change callback
      capturedContentChangeHandler!()

      // Verify AI store was updated with new model content
      const ctx = useAiStore.getState().tabs['tab-1']?.attachedContext
      expect(ctx).not.toBeNull()
      expect(ctx!.sql).toBe('SELECT 1')
      expect(ctx!.range).toEqual({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 9, // line length 8 + 1
      })
    })

    it('does not update AI context when no attached context exists', () => {
      // No AI context set — attachedContext is null by default
      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

      capturedContentChangeHandler!()

      // triggerCodeLensRefresh should still be called
      expect(mockTriggerCodeLensRefresh()).toHaveBeenCalledTimes(1)
      // AI store should have no attached context for this tab
      const ctx = useAiStore.getState().tabs['tab-1']?.attachedContext
      expect(ctx).toBeFalsy()
    })

    it('handles null model gracefully during AI context update', () => {
      // Set up AI context
      useAiStore.getState().setAttachedContext('tab-1', {
        sql: 'old',
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 },
      })

      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

      // Simulate model being null when content change fires
      mockEditorInstance.getModel.mockReturnValue(
        null as unknown as ReturnType<typeof mockEditorInstance.getModel>
      )

      capturedContentChangeHandler!()

      // triggerCodeLensRefresh is still called
      expect(mockTriggerCodeLensRefresh()).toHaveBeenCalledTimes(1)
      // The context should remain unchanged (the old value) since model was null
      const ctx = useAiStore.getState().tabs['tab-1']?.attachedContext
      expect(ctx!.sql).toBe('old')
    })
  })

  // -----------------------------------------------------------------------
  // F9 / F12 keybinding handler tests
  // -----------------------------------------------------------------------

  describe('keybinding handlers', () => {
    it('F9 handler dispatches execute-query action through shortcut store', () => {
      const dispatchSpy = vi.spyOn(useShortcutStore.getState(), 'dispatchAction')

      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

      // F9 key code is 78 in our mock
      expect(capturedAddCommandHandlers[78]).toBeDefined()
      capturedAddCommandHandlers[78]()

      expect(dispatchSpy).toHaveBeenCalledWith('execute-query')
      dispatchSpy.mockRestore()
    })

    it('F12 handler dispatches format-query action through shortcut store', () => {
      const dispatchSpy = vi.spyOn(useShortcutStore.getState(), 'dispatchAction')

      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

      // F12 key code is 81 in our mock
      expect(capturedAddCommandHandlers[81]).toBeDefined()
      capturedAddCommandHandlers[81]()

      expect(dispatchSpy).toHaveBeenCalledWith('format-query')
      dispatchSpy.mockRestore()
    })

    it('CtrlCmd+T handler dispatches new-query-tab action through shortcut store', () => {
      const dispatchSpy = vi.spyOn(useShortcutStore.getState(), 'dispatchAction')

      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

      // CtrlCmd+T is KeyMod.CtrlCmd | KeyCode.KeyT in our mock
      expect(capturedAddCommandHandlers[2100]).toBeDefined()
      capturedAddCommandHandlers[2100]()

      expect(dispatchSpy).toHaveBeenCalledWith('new-query-tab')
      dispatchSpy.mockRestore()
    })

    it('remapped shortcut handler dispatches new-query-tab through shortcut store', () => {
      useShortcutStore.setState({
        shortcuts: {
          ...DEFAULT_SHORTCUTS,
          'new-query-tab': { key: 'N', modifiers: ['ctrl', 'shift'] },
        },
      })

      const dispatchSpy = vi.spyOn(useShortcutStore.getState(), 'dispatchAction')

      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

      expect(capturedAddCommandHandlers[3121]).toBeDefined()
      capturedAddCommandHandlers[3121]()

      expect(dispatchSpy).toHaveBeenCalledWith('new-query-tab')
      dispatchSpy.mockRestore()
    })
  })

  // -----------------------------------------------------------------------
  // contentChangeDisposable disposal test
  // -----------------------------------------------------------------------

  describe('content change disposable', () => {
    it('disposes the content-change listener when the editor is disposed', () => {
      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

      expect(mockEditorInstance.onDidChangeModelContent).toHaveBeenCalledTimes(1)

      // Trigger editor dispose
      const handleDispose = registeredDisposeHandlers[0]
      handleDispose()

      expect(mockContentChangeDispose).toHaveBeenCalledTimes(1)
    })

    it('disposes the selection-change listener when the editor is disposed', () => {
      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

      const handleDispose = registeredDisposeHandlers[0]
      handleDispose()

      expect(mockSelectionDispose).toHaveBeenCalledTimes(1)
    })
  })

  describe('selection tracking', () => {
    it('stores selected text when Monaco selection changes', () => {
      mockEditorInstance.getModel.mockImplementation(() => createMockModel('SELECT'))

      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

      expect(capturedSelectionChangeHandler).not.toBeNull()
      capturedSelectionChangeHandler!({
        selection: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 7,
        },
      })

      expect(useQueryStore.getState().tabs['tab-1']?.selectedText).toBe('SELECT')
    })

    it('initializes selected text to empty when nothing is selected', () => {
      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

      expect(useQueryStore.getState().tabs['tab-1']?.selectedText).toBe('')
    })
  })

  describe('Save as Favorite context-menu action', () => {
    beforeEach(() => {
      useFavoritesStore.setState({ dialogOpen: false, editingFavorite: null })
    })

    it('registers the save-as-favorite action in query-store mode', () => {
      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

      expect(capturedActions['sqllumen.save-as-favorite']).toBeDefined()
    })

    it('does not register the action in override mode', () => {
      render(<MonacoEditorWrapper tabId="tab-1" value="SELECT 1" onChange={() => {}} />)

      expect(capturedActions['sqllumen.save-as-favorite']).toBeUndefined()
    })

    it('opens the favorites dialog pre-populated with the current statement', () => {
      mockEditorInstance.getModel.mockImplementation(() => createMockModel())
      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

      act(() => {
        capturedActions['sqllumen.save-as-favorite'].run(mockEditorInstance)
      })

      const state = useFavoritesStore.getState()
      expect(state.dialogOpen).toBe(true)
      expect(state.editingFavorite?.sqlText).toBe('SELECT 1')
      expect(state.editingFavorite?.id).toBe(0)
      expect(state.editingFavorite?.connectionId).toBe('conn-1')
    })

    it('pre-populates with the selected text when a selection exists', () => {
      mockEditorInstance.getModel.mockImplementation(() => createMockModel('SELECT 42'))
      mockEditorInstance.getSelection.mockImplementation(() => ({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 10,
      }))
      render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

      act(() => {
        capturedActions['sqllumen.save-as-favorite'].run(mockEditorInstance)
      })

      expect(useFavoritesStore.getState().editingFavorite?.sqlText).toBe('SELECT 42')
    })
  })
})
