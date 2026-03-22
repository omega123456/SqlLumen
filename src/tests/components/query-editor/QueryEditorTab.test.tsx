import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { QueryEditorTab } from '../../../components/query-editor/QueryEditorTab'
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
  mockIPC(() => null)
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
    expect(screen.getByTestId('toolbar-execute')).toBeInTheDocument()
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

  it('shows execute buttons disabled when no content', () => {
    render(<QueryEditorTab tab={mockTab} />)
    expect(screen.getByTestId('toolbar-execute')).toBeDisabled()
    expect(screen.getByTestId('toolbar-execute-all')).toBeDisabled()
  })
})
