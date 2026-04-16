import type { ReactElement } from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { WorkspaceAiResizableRow } from '../../../components/layout/WorkspaceAiResizableRow'
import { AiDiffBridgeProvider } from '../../../components/query-editor/ai-diff-bridge-context'
import { useSettingsStore, SETTINGS_DEFAULTS } from '../../../stores/settings-store'
import { useAiStore } from '../../../stores/ai-store'
import type { TabAiState } from '../../../stores/ai-store'
import type { QueryEditorTab as QueryEditorTabType } from '../../../types/schema'

const mockTab: QueryEditorTabType = {
  id: 'tab-1',
  type: 'query-editor',
  label: 'Query 1',
  connectionId: 'conn-1',
}

function emptyAiTabState(overrides: Partial<TabAiState> = {}): TabAiState {
  return {
    messages: [],
    isGenerating: false,
    activeStreamId: null,
    attachedContext: null,
    isPanelOpen: false,
    error: null,
    retrievedSchemaDdl: '',
    lastRetrievalTimestamp: 0,
    isWaitingForIndex: false,
    connectionId: null,
    _unlisten: null,
    ...overrides,
  }
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
    if (cmd === 'get_setting') {
      return null
    }
    if (cmd === 'set_setting') {
      return undefined
    }
    if (cmd === 'get_all_settings') {
      return {}
    }
    if (cmd === 'ai_chat') {
      return undefined
    }
    if (cmd === 'ai_cancel') {
      return undefined
    }
    if (cmd === 'ai_query_expand') {
      return { text: '{"queries":["q1","q2","q3"]}' }
    }
    if (cmd === 'semantic_search') {
      return []
    }
    if (cmd === 'build_schema_index') {
      return undefined
    }
    if (cmd === 'get_index_status') {
      return { status: 'ready' }
    }
    if (cmd === 'invalidate_schema_index') {
      return undefined
    }
    if (cmd === 'list_indexed_tables') {
      return []
    }
    if (cmd === 'fetch_schema_metadata') {
      return {
        databases: ['testdb'],
        tables: {
          testdb: [
            { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 10, dataSize: 1024 },
          ],
        },
        columns: {
          'testdb.users': [
            { name: 'id', dataType: 'INT' },
            { name: 'name', dataType: 'VARCHAR(255)' },
          ],
        },
        routines: {},
      }
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
      'ai.embeddingModel': 'nomic-embed-text',
    },
    pendingChanges: {},
    isDirty: false,
    isLoading: false,
    activeSection: 'ai',
    isDialogOpen: false,
    dialogSection: undefined,
  })
})

describe('WorkspaceAiResizableRow', () => {
  it('shows AiPanel when the store panel is open', () => {
    useAiStore.setState({
      tabs: { 'tab-1': emptyAiTabState({ isPanelOpen: true }) },
    })
    renderWithBridge(
      <WorkspaceAiResizableRow tab={mockTab}>
        <div data-testid="workspace-child">content</div>
      </WorkspaceAiResizableRow>
    )
    expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-child')).toBeInTheDocument()
  })

  it('closes the panel when the header close button is clicked', async () => {
    const user = userEvent.setup()
    useAiStore.setState({
      tabs: { 'tab-1': emptyAiTabState({ isPanelOpen: true }) },
    })
    renderWithBridge(
      <WorkspaceAiResizableRow tab={mockTab}>
        <div>content</div>
      </WorkspaceAiResizableRow>
    )
    await user.click(screen.getByTestId('ai-close-button'))
    expect(useAiStore.getState().tabs['tab-1']?.isPanelOpen).toBe(false)
  })
})
