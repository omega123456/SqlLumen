/**
 * Test: editor.focus() should be called when MonacoEditorWrapper mounts
 * in a new query tab so the user can immediately start typing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { useQueryStore } from '../../../stores/query-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useAiStore } from '../../../stores/ai-store'
import { resetWorkspaceStore } from '../../helpers/workspace-test-utils'
import type { QueryEditorTab as QueryEditorTabType } from '../../../types/schema'
import * as SchemaMetadataCacheModule from '../../../components/query-editor/schema-metadata-cache'
import * as CompletionServiceModule from '../../../components/query-editor/completion-service'
import * as MonacoEditorReactModule from '@monaco-editor/react'

// IPC fixtures in setup.ts handle plugin:dialog|save, plugin:dialog|open, and all other commands.
// Monaco, monaco-sql-languages, and monaco-sql-languages/esm are globally mocked in setup.ts.
// Use vi.spyOn to install per-test mock implementations without vi.mock().

import React from 'react'

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
    columns: {},
    routines: {},
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

import { QueryEditorTab } from '../../../components/query-editor/QueryEditorTab'

describe('QueryEditorTab - editor focus on mount', () => {
  it('calls editor.focus() when the Monaco editor mounts in a new query tab', async () => {
    render(<QueryEditorTab tab={mockTab} />)

    await waitFor(() => {
      expect(mockFocus).toHaveBeenCalled()
    })
  })
})
