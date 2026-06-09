import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useQueryStore } from '../../../stores/query-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useAiStore } from '../../../stores/ai-store'
import { resetWorkspaceStore } from '../../helpers/workspace-test-utils'
import type { QueryEditorTab as QueryEditorTabType } from '../../../types/schema'
import * as SchemaMetadataCacheModule from '../../../components/query-editor/schema-metadata-cache'
import * as CompletionServiceModule from '../../../components/query-editor/completion-service'
import * as MonacoEditorReactModule from '@monaco-editor/react'
import { makeAiTabState } from '../../helpers/ai-test-utils'

// IPC fixtures in setup.ts handle plugin:dialog|save, plugin:dialog|open, and all other commands.
// Monaco, monaco-sql-languages, and monaco-sql-languages/esm are globally mocked in setup.ts.
// Use vi.spyOn to install per-test mock implementations without vi.mock().

import React from 'react'

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

import { QueryEditorTab } from '../../../components/query-editor/QueryEditorTab'

const mockTab: QueryEditorTabType = {
  id: 'tab-1',
  type: 'query-editor',
  label: 'Query 1',
  connectionId: 'conn-1',
}

const emptyAiTabState = makeAiTabState

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
