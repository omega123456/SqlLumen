import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useQueryStore } from '../../../stores/query-store'
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

// Mock schema-metadata-cache (MonacoEditorWrapper loads cache on mount)
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

// Mock the mysql-language-setup side-effect import
vi.mock('../../../components/query-editor/mysql-language-setup', () => ({}))

// Mock completion-service
vi.mock('../../../components/query-editor/completion-service', () => ({
  registerModelConnection: vi.fn(),
  unregisterModelConnection: vi.fn(),
  resetModelConnections: vi.fn(),
  completionService: vi.fn(async () => []),
}))

// ---------------------------------------------------------------------------
// Mock editor instance with layout() spy
// ---------------------------------------------------------------------------
const mockLayout = vi.fn()
const mockEditorInstance = {
  layout: mockLayout,
  onDidChangeCursorPosition: vi.fn(() => ({ dispose: vi.fn() })),
  onDidDispose: vi.fn(),
  getModel: vi.fn(() => ({ uri: { toString: () => 'inmemory://model/1' } })),
  setPosition: vi.fn(),
  revealPositionInCenter: vi.fn(),
}

// Override @monaco-editor/react to call onMount with our mock editor
vi.mock('@monaco-editor/react', async () => {
  const React = await import('react')
  return {
    default: (props: Record<string, unknown>) => {
      function MockEditor() {
        React.useEffect(() => {
          const onMount = props.onMount as
            | ((editor: typeof mockEditorInstance, monaco: Record<string, unknown>) => void)
            | undefined
          onMount?.(mockEditorInstance, {
            editor: { defineTheme: vi.fn(), setTheme: vi.fn() },
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
      editor: { defineTheme: vi.fn(), setTheme: vi.fn() },
      languages: {},
    }),
    loader: { init: () => Promise.resolve(), config: () => {} },
  }
})

// ---------------------------------------------------------------------------
// Mock react-resizable-panels to capture Panel onResize props
// ---------------------------------------------------------------------------
const panelRenders: Array<Record<string, unknown>> = []

vi.mock('react-resizable-panels', async () => {
  const React = await import('react')
  return {
    Group: (props: Record<string, unknown>) =>
      React.createElement('div', { 'data-testid': 'rsp-group' }, props.children as React.ReactNode),
    Panel: (props: Record<string, unknown>) => {
      panelRenders.push(props)
      return React.createElement(
        'div',
        { 'data-testid': 'rsp-panel', className: props.className as string },
        props.children as React.ReactNode
      )
    },
    Separator: (props: Record<string, unknown>) =>
      React.createElement(
        'div',
        { 'data-testid': 'rsp-separator' },
        props.children as React.ReactNode
      ),
    usePanelRef: () => ({ current: null }),
  }
})

// Import after mocks are set up (vi.mock is hoisted automatically)
import { QueryEditorTab } from '../../../components/query-editor/QueryEditorTab'

const mockTab: QueryEditorTabType = {
  id: 'tab-1',
  type: 'query-editor',
  label: 'Query 1',
  connectionId: 'conn-1',
}

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  useWorkspaceStore.setState({ tabsByConnection: {}, activeTabByConnection: {} })
  _resetTabIdCounter()
  _resetQueryTabCounter()
  mockIPC((cmd) => {
    if (cmd === 'log_frontend') return undefined
    if (cmd === 'plugin:event|listen') return () => {}
    if (cmd === 'plugin:event|unlisten') return undefined
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
  })
  panelRenders.length = 0
  mockLayout.mockClear()
  mockEditorInstance.onDidChangeCursorPosition.mockClear()
  mockEditorInstance.onDidDispose.mockClear()
  mockEditorInstance.getModel.mockClear()
  mockEditorInstance.setPosition.mockClear()
  mockEditorInstance.revealPositionInCenter.mockClear()
})

describe('QueryEditorTab — panel resize', () => {
  it('passes an onResize handler to the editor panel', () => {
    render(<QueryEditorTab tab={mockTab} />)

    // The first Panel rendered is the editor panel (defaultSize="60%")
    const editorPanelProps = panelRenders[0]
    expect(editorPanelProps).toBeDefined()
    expect(typeof editorPanelProps.onResize).toBe('function')
  })

  it('calls editor.layout() when the editor panel is resized', () => {
    render(<QueryEditorTab tab={mockTab} />)

    // The first Panel rendered is the editor panel
    const editorPanelProps = panelRenders[0]
    const onResize = editorPanelProps.onResize as (size: number) => void

    // Simulate a panel resize
    onResize(50)

    expect(mockLayout).toHaveBeenCalled()
  })
})
