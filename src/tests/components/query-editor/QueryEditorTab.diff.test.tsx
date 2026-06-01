/**
 * Tests for the diff overlay flow in QueryEditorTab — triggering diff,
 * accepting, rejecting, and stale-range validation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryEditorTab } from '../../../components/query-editor/QueryEditorTab'
import { AiDiffBridgeProvider } from '../../../components/query-editor/ai-diff-bridge-context'
import { WorkspaceBody } from '../../../components/layout/WorkspaceBody'
import { useQueryStore } from '../../../stores/query-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useAiStore } from '../../../stores/ai-store'
import { resetWorkspaceStore } from '../../helpers/workspace-test-utils'
import { useToastStore } from '../../../stores/toast-store'
import type { QueryEditorTab as QueryEditorTabType } from '../../../types/schema'
import { makeAiTabState } from '../../helpers/ai-test-utils'

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
  it('does not render diff overlay by default', () => {
    useAiStore.setState({
      tabs: { 'tab-1': emptyAiTabState() },
    })
    render(<QueryEditorTab tab={mockTab} />)
    expect(screen.queryByTestId('diff-overlay')).not.toBeInTheDocument()
  })

  it('renders AI panel with proper testid when AI is enabled and panel is open', async () => {
    useAiStore.setState({
      tabs: { 'tab-1': emptyAiTabState({ isPanelOpen: true }) },
    })
    renderQueryTabWithAiWorkspace()
    expect(await screen.findByTestId('ai-panel')).toBeInTheDocument()
  })

  it('does not show diff overlay when AI is disabled', () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, 'ai.enabled': 'false' },
    })
    render(<QueryEditorTab tab={mockTab} />)
    expect(screen.queryByTestId('diff-overlay')).not.toBeInTheDocument()
  })

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
