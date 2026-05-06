/**
 * Test: editor.focus() should be called when MonacoEditorWrapper mounts
 * in a new query tab so the user can immediately start typing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { useQueryStore } from '../../../stores/query-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useAiStore } from '../../../stores/ai-store'
import {
  useWorkspaceStore,
  _resetTabIdCounter,
  _resetQueryTabCounter,
} from '../../../stores/workspace-store'
import type { QueryEditorTab as QueryEditorTabType } from '../../../types/schema'

// Mock tauri dialog
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(() => Promise.resolve(null)),
  open: vi.fn(() => Promise.resolve(null)),
}))

// Mock schema-metadata-cache
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

vi.mock('monaco-sql-languages/esm/languages/mysql/mysql.contribution', () => ({}))
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
vi.mock('../../../components/query-editor/mysql-language-setup', () => ({}))
vi.mock('../../../components/query-editor/completion-service', () => ({
  registerModelConnection: vi.fn(),
  unregisterModelConnection: vi.fn(),
  resetModelConnections: vi.fn(),
  completionService: vi.fn(async () => []),
}))

// Mock editor with focus spy
const mockFocus = vi.fn()
const mockEditorInstance = {
  focus: mockFocus,
  layout: vi.fn(),
  onDidChangeCursorPosition: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeCursorSelection: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
  onDidDispose: vi.fn(),
  getModel: vi.fn(() => ({
    uri: { toString: () => 'inmemory://model/1' },
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
  addCommand: vi.fn(),
  updateOptions: vi.fn(),
}

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
            KeyCode: { F9: 78, F12: 81 },
          })
        }, [])

        return React.createElement('textarea', {
          'data-testid': 'monaco-editor',
          value: (props.value as string) ?? '',
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

vi.mock('react-resizable-panels', async () => {
  const React = await import('react')
  return {
    Group: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'panel-group' }, children),
    Panel: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    Separator: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
  }
})

const mockTab: QueryEditorTabType = {
  id: 'tab-focus-1',
  type: 'query-editor',
  label: 'Query 1',
  connectionId: 'conn-1',
}

beforeEach(() => {
  mockFocus.mockClear()
  useQueryStore.setState({ tabs: {} })
  useWorkspaceStore.setState({ tabsByConnection: {}, activeTabByConnection: {} })
  useAiStore.setState({ tabs: {} })
  _resetTabIdCounter()
  _resetQueryTabCounter()
  mockIPC(() => null)
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'false' },
  })
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
import { QueryEditorTab } from '../../../components/query-editor/QueryEditorTab'

describe('QueryEditorTab - editor focus on mount', () => {
  it('calls editor.focus() when the Monaco editor mounts in a new query tab', async () => {
    render(<QueryEditorTab tab={mockTab} />)

    await waitFor(() => {
      expect(mockFocus).toHaveBeenCalled()
    })
  })
})
