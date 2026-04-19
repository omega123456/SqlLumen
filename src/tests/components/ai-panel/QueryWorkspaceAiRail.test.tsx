import type { ReactElement } from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { QueryWorkspaceAiRail } from '../../../components/ai-panel/QueryWorkspaceAiRail'
import { AiDiffBridgeProvider } from '../../../components/query-editor/ai-diff-bridge-context'
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../../stores/settings-store'
import { useAiStore } from '../../../stores/ai-store'
import type { QueryEditorTab as QueryEditorTabType } from '../../../types/schema'

const mockTab: QueryEditorTabType = {
  id: 'tab-1',
  type: 'query-editor',
  label: 'Query 1',
  connectionId: 'conn-1',
}

function setupMockIPC() {
  mockIPC((cmd) => {
    if (cmd === 'log_frontend') {
      return undefined
    }
    if (cmd === 'plugin:event|listen') {
      return () => {}
    }
    if (cmd === 'plugin:event|unlisten') {
      return undefined
    }
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
  })
}

function renderWithBridge(ui: ReactElement) {
  return render(<AiDiffBridgeProvider>{ui}</AiDiffBridgeProvider>)
}

beforeEach(() => {
  setupMockIPC()
  useAiStore.setState({ tabs: {} })
  useSettingsStore.setState({
    settings: {
      ...SETTINGS_DEFAULTS,
      'ai.enabled': 'true',
    },
    pendingChanges: {},
    isDirty: false,
    isLoading: false,
    activeSection: 'ai',
    isDialogOpen: false,
    dialogSection: undefined,
  })
})

describe('QueryWorkspaceAiRail', () => {
  it('renders the icon rail', () => {
    renderWithBridge(<QueryWorkspaceAiRail tab={mockTab} />)
    expect(screen.getByTestId('ai-workspace-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('ai-workspace-rail')).toBeInTheDocument()
    expect(screen.getByTestId('ai-sidebar-expand')).toBeInTheDocument()
  })

  it('opens the AI panel in the store when the rail button is clicked', async () => {
    const user = userEvent.setup()
    useAiStore.setState({
      tabs: {
        'tab-1': {
          messages: [],
          isGenerating: false,
          activeStreamId: null,
          previousResponseId: null,
          attachedContext: null,
          isPanelOpen: false,
          error: null,
          retrievedSchemaDdl: '',
          lastRetrievalTimestamp: 0,
          schemaContextBuildTimestamp: 0,
          schemaContextQueryKey: '',
          lastCompletedSystemPrompt: '',
          lastCompletedTransport: null,
          lastCompletedEndpoint: '',
          lastCompletedModel: '',
          activeRequestEndpoint: '',
          activeRequestModel: '',
          activeStreamHasAssistantOutput: false,
          isWaitingForIndex: false,
          connectionId: null,
          _unlisten: null,
        },
      },
    })
    renderWithBridge(<QueryWorkspaceAiRail tab={mockTab} />)
    await user.click(screen.getByTestId('ai-sidebar-expand'))
    expect(useAiStore.getState().tabs['tab-1']?.isPanelOpen).toBe(true)
  })
})
