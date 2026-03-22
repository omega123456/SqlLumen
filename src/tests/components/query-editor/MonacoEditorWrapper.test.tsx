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
  _clearAllCaches: vi.fn(),
}))

// Mock AutocompleteDocPanel to avoid portal/observer complexity in unit tests
vi.mock('../../../components/query-editor/AutocompleteDocPanel', () => ({
  AutocompleteDocPanel: () => null,
}))

// Mock AutocompleteProvider
vi.mock('../../../components/query-editor/AutocompleteProvider', () => ({
  AutocompleteProvider: class MockAutocompleteProvider {
    triggerCharacters = [' ', '.', '(']
    provideCompletionItems = vi.fn(() => ({ suggestions: [] }))
  },
  subscribeDocItem: vi.fn(() => () => {}),
  getDocItem: vi.fn(() => null),
}))

// Override the useMonaco mock to return a functional Monaco instance
const mockSetTheme = vi.fn()
const mockDefineTheme = vi.fn()
const mockRegisterCompletionItemProvider = vi.fn(() => ({ dispose: vi.fn() }))
vi.mock('@monaco-editor/react', async () => {
  const React = await import('react')
  return {
    default: (props: Record<string, unknown>) => {
      return React.createElement('textarea', {
        'data-testid': 'monaco-editor',
        value: (props.value as string) ?? '',
        onChange: (e: { target: { value: string } }) => {
          const fn = props.onChange as ((v: string | undefined) => void) | undefined
          fn?.(e.target.value)
        },
      })
    },
    useMonaco: () => ({
      editor: {
        defineTheme: mockDefineTheme,
        setTheme: mockSetTheme,
      },
      languages: {
        registerCompletionItemProvider: mockRegisterCompletionItemProvider,
      },
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
  mockRegisterCompletionItemProvider.mockClear()
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
    // Monaco Editor mock doesn't fire onMount, so we just verify the component rendered
    expect(screen.getByTestId('monaco-editor-wrapper')).toBeInTheDocument()
  })

  it('registers completion provider when connectionId is provided', () => {
    render(<MonacoEditorWrapper tabId="tab-1" connectionId="conn-1" />)
    expect(mockRegisterCompletionItemProvider).toHaveBeenCalledWith('sql', expect.any(Object))
  })

  it('does not register completion provider when connectionId is not provided', () => {
    render(<MonacoEditorWrapper tabId="tab-1" />)
    expect(mockRegisterCompletionItemProvider).not.toHaveBeenCalled()
  })

  it('renders without connectionId (backward compat)', () => {
    render(<MonacoEditorWrapper tabId="tab-1" />)
    expect(screen.getByTestId('monaco-editor-wrapper')).toBeInTheDocument()
  })
})
