import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MonacoEditorWrapper } from '../../../components/query-editor/MonacoEditorWrapper'
import { useQueryStore } from '../../../stores/query-store'

// Mock the schema-metadata-cache (loadCache is called on mount)
vi.mock('../../../components/query-editor/schema-metadata-cache', () => ({
  loadCache: vi.fn(() => Promise.resolve()),
  getCache: vi.fn(() => ({
    status: 'empty',
    databases: [],
    tables: {},
    columns: {},
    routines: {},
  })),
  getPendingLoad: vi.fn(() => null),
  _clearAllCaches: vi.fn(),
}))

// Mock monaco-sql-languages contribution (side-effect import)
vi.mock('monaco-sql-languages/esm/languages/mysql/mysql.contribution', () => ({}))

// Mock monaco-sql-languages named exports
vi.mock('monaco-sql-languages', () => ({
  setupLanguageFeatures: vi.fn(),
  LanguageIdEnum: { MYSQL: 'mysql' },
  EntityContextType: {
    DATABASE: 'database',
    TABLE: 'table',
    COLUMN: 'column',
    FUNCTION: 'function',
    PROCEDURE: 'procedure',
  },
}))

// Mock the mysql-language-setup side-effect import (no-op in tests)
vi.mock('../../../components/query-editor/mysql-language-setup', () => ({}))

// Mock the completion-service model registry
const mockRegisterModelConnection = vi.fn()
const mockUnregisterModelConnection = vi.fn()
vi.mock('../../../components/query-editor/completion-service', () => ({
  registerModelConnection: (...args: unknown[]) => mockRegisterModelConnection(...args),
  unregisterModelConnection: (...args: unknown[]) => mockUnregisterModelConnection(...args),
  resetModelConnections: vi.fn(),
  completionService: vi.fn(async () => []),
}))

// Override the useMonaco mock to return a functional Monaco instance
const mockSetTheme = vi.fn()
const mockDefineTheme = vi.fn()
const mockCursorPositionDispose = vi.fn()
const mockOnDidDispose = vi.fn()
const registeredDisposeHandlers: Array<() => void> = []
const mockModelUri = { toString: () => 'inmemory://model/1' }
const mockEditorInstance = {
  setPosition: vi.fn(),
  revealPositionInCenter: vi.fn(),
  onDidChangeCursorPosition: vi.fn(() => ({ dispose: mockCursorPositionDispose })),
  onDidDispose: vi.fn((handler: () => void) => {
    mockOnDidDispose(handler)
    registeredDisposeHandlers.push(handler)
  }),
  getModel: vi.fn(() => ({ uri: mockModelUri })),
}
// Track props passed to the mock Editor component
const mockEditorComponent = vi.fn()
vi.mock('@monaco-editor/react', async () => {
  const React = await import('react')
  return {
    default: (props: Record<string, unknown>) => {
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
    },
    useMonaco: () => ({
      editor: {
        defineTheme: mockDefineTheme,
        setTheme: mockSetTheme,
      },
      languages: {},
    }),
    loader: {
      init: () => Promise.resolve(),
      config: () => {},
    },
  }
})

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  mockSetTheme.mockClear()
  mockDefineTheme.mockClear()
  mockCursorPositionDispose.mockClear()
  mockOnDidDispose.mockClear()
  mockEditorInstance.setPosition.mockClear()
  mockEditorInstance.revealPositionInCenter.mockClear()
  mockEditorInstance.onDidChangeCursorPosition.mockClear()
  mockEditorInstance.onDidDispose.mockClear()
  mockEditorInstance.getModel.mockClear()
  mockRegisterModelConnection.mockClear()
  mockUnregisterModelConnection.mockClear()
  mockEditorComponent.mockClear()
  registeredDisposeHandlers.length = 0
})

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
    expect(mockRegisterModelConnection).toHaveBeenCalledWith('inmemory://model/1', 'conn-1')
  })

  it('does not register model-connection mapping when connectionId is not provided', () => {
    render(<MonacoEditorWrapper tabId="tab-1" />)
    expect(mockRegisterModelConnection).not.toHaveBeenCalled()
  })

  it('unregisters model-connection mapping on editor dispose', () => {
    render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

    expect(mockOnDidDispose).toHaveBeenCalledTimes(1)
    const handleDispose = registeredDisposeHandlers[0]
    handleDispose()

    expect(mockUnregisterModelConnection).toHaveBeenCalledWith('inmemory://model/1')
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

  it('unregisters model-connection using captured URI even when getModel returns null on dispose', () => {
    render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)

    // Verify initial registration used the correct URI
    expect(mockRegisterModelConnection).toHaveBeenCalledWith('inmemory://model/1', 'conn-1')

    // Simulate the model being disposed before our handler runs
    // (getModel returns null when Monaco has already cleaned up)
    mockEditorInstance.getModel.mockReturnValue(null as unknown as { uri: typeof mockModelUri })

    // Trigger the dispose handler
    const handleDispose = registeredDisposeHandlers[0]
    handleDispose()

    // Should still unregister using the captured URI from mount time
    expect(mockUnregisterModelConnection).toHaveBeenCalledWith('inmemory://model/1')
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
            status: 'running',
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
})
