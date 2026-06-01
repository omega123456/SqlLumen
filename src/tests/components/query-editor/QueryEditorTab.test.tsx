import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryEditorTab } from '../../../components/query-editor/QueryEditorTab'
import { useQueryStore } from '../../../stores/query-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useAiStore } from '../../../stores/ai-store'
import { resetWorkspaceStore } from '../../helpers/workspace-test-utils'
import type { QueryEditorTab as QueryEditorTabType } from '../../../types/schema'
import { makeAiTabState } from '../../helpers/ai-test-utils'

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
  it('renders with data-testid', () => {
    render(<QueryEditorTab tab={mockTab} />)
    expect(screen.getByTestId('query-editor-tab')).toBeInTheDocument()
  })

  it('renders the editor toolbar', () => {
    render(<QueryEditorTab tab={mockTab} />)
    expect(screen.getByTestId('editor-toolbar')).toBeInTheDocument()
  })

  it('renders Monaco editor wrapper', async () => {
    render(<QueryEditorTab tab={mockTab} />)
    expect(await screen.findByTestId('monaco-editor-wrapper')).toBeInTheDocument()
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

  it('still renders editor and result panel when AI is enabled in settings', async () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'true' },
    })
    render(<QueryEditorTab tab={mockTab} />)
    expect(await screen.findByTestId('monaco-editor-wrapper')).toBeInTheDocument()
    expect(screen.getByTestId('result-panel')).toBeInTheDocument()
  })
})
