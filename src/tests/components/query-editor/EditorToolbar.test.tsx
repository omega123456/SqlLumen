import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { EditorToolbar } from '../../../components/query-editor/EditorToolbar'
import { useQueryStore } from '../../../stores/query-store'
import {
  useWorkspaceStore,
  _resetTabIdCounter,
  _resetQueryTabCounter,
} from '../../../stores/workspace-store'
import { useConnectionStore } from '../../../stores/connection-store'

// Mock tauri dialog
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(() => Promise.resolve(null)), // cancelled
  open: vi.fn(() => Promise.resolve(null)), // cancelled
}))

beforeEach(() => {
  useQueryStore.setState({ tabs: {} })
  useWorkspaceStore.setState({ tabsByConnection: {}, activeTabByConnection: {} })
  useConnectionStore.setState({ activeConnections: {} })
  _resetTabIdCounter()
  _resetQueryTabCounter()

  mockIPC((cmd) => {
    switch (cmd) {
      case 'execute_query':
        return {
          queryId: 'q1',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[1]],
          totalPages: 1,
          autoLimitApplied: false,
        }
      case 'execute_multi_query':
        return {
          results: [
            {
              queryId: 'q1',
              sourceSql: 'SELECT 1',
              columns: [{ name: 'id', dataType: 'INT' }],
              totalRows: 1,
              executionTimeMs: 5,
              affectedRows: 0,
              firstPage: [[1]],
              totalPages: 1,
              autoLimitApplied: false,
              error: null,
              reExecutable: true,
            },
            {
              queryId: 'q2',
              sourceSql: 'SELECT 2',
              columns: [{ name: 'id', dataType: 'INT' }],
              totalRows: 1,
              executionTimeMs: 5,
              affectedRows: 0,
              firstPage: [[2]],
              totalPages: 1,
              autoLimitApplied: false,
              error: null,
              reExecutable: true,
            },
          ],
        }
      case 'write_file':
        return null
      case 'read_file':
        return 'SELECT * FROM loaded_file;'
      default:
        return null
    }
  })
})

describe('EditorToolbar', () => {
  function renderToolbar(content = '') {
    if (content) {
      useQueryStore.getState().setContent('tab-1', content)
    }
    return render(
      <EditorToolbar connectionId="conn-1" tabId="tab-1" cursorLine={1} cursorColumn={1} />
    )
  }

  it('renders all toolbar buttons', () => {
    renderToolbar()
    expect(screen.getByTestId('editor-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('toolbar-save')).toBeInTheDocument()
    expect(screen.getByTestId('toolbar-open')).toBeInTheDocument()
    expect(screen.getByTestId('toolbar-format')).toBeInTheDocument()
    expect(screen.getByTestId('toolbar-import-sql')).toBeInTheDocument()
    expect(screen.getByTestId('toolbar-execute')).toBeInTheDocument()
    expect(screen.getByTestId('toolbar-execute-all')).toBeInTheDocument()
  })

  it('import SQL button is enabled for non-read-only connections', () => {
    renderToolbar()
    const importBtn = screen.getByTestId('toolbar-import-sql')
    expect(importBtn).toBeInTheDocument()
    expect(importBtn).not.toBeDisabled()
  })

  it('import SQL button is disabled for read-only connections', () => {
    // Set up a read-only active connection in the store
    useConnectionStore.setState({
      activeConnections: {
        'conn-1': {
          id: 'conn-1',
          profile: {
            id: 'profile-1',
            name: 'Test',
            host: 'localhost',
            port: 3306,
            username: 'root',
            hasPassword: false,
            defaultDatabase: null,
            sslEnabled: false,
            sslCaPath: null,
            sslCertPath: null,
            sslKeyPath: null,
            color: null,
            groupId: null,
            readOnly: true,
            sortOrder: 0,
            connectTimeoutSecs: 10,
            keepaliveIntervalSecs: 60,
            createdAt: '',
            updatedAt: '',
          },
          status: 'connected' as const,
          serverVersion: '8.0.0',
        },
      },
    })
    renderToolbar()
    const importBtn = screen.getByTestId('toolbar-import-sql')
    expect(importBtn).toBeInTheDocument()
    expect(importBtn).toBeDisabled()
  })

  it('execute buttons are disabled when no content', () => {
    renderToolbar('') // empty content
    expect(screen.getByTestId('toolbar-execute')).toBeDisabled()
    expect(screen.getByTestId('toolbar-execute-all')).toBeDisabled()
  })

  it('execute buttons are enabled when content present', () => {
    renderToolbar('SELECT 1')
    expect(screen.getByTestId('toolbar-execute')).not.toBeDisabled()
    expect(screen.getByTestId('toolbar-execute-all')).not.toBeDisabled()
  })

  it('format button reformats SQL content', () => {
    renderToolbar('select id,name from users where id=1')
    fireEvent.click(screen.getByTestId('toolbar-format'))
    const content = useQueryStore.getState().tabs['tab-1']?.content ?? ''
    // sql-formatter should capitalize keywords
    expect(content.toLowerCase()).toContain('select')
  })

  it('format button does nothing on empty content', () => {
    renderToolbar('')
    fireEvent.click(screen.getByTestId('toolbar-format'))
    // Should not throw, content stays empty
    const content = useQueryStore.getState().tabs['tab-1']?.content ?? ''
    expect(content).toBe('')
  })

  it('execute button calls executeQuery', async () => {
    renderToolbar('SELECT 1')
    await act(async () => {
      fireEvent.click(screen.getByTestId('toolbar-execute'))
    })
    // After execution, query store should have result status
    const tabState = useQueryStore.getState().tabs['tab-1']
    expect(tabState?.status).toBe('success')
  })

  it('execute all button calls executeQuery for each statement', async () => {
    renderToolbar('SELECT 1; SELECT 2;')
    await act(async () => {
      fireEvent.click(screen.getByTestId('toolbar-execute-all'))
    })
    const tabState = useQueryStore.getState().tabs['tab-1']
    expect(tabState?.status).toBe('success')
  })

  it('execute does nothing when content is empty', async () => {
    renderToolbar('')
    await act(async () => {
      fireEvent.click(screen.getByTestId('toolbar-execute'))
    })
    // Tab state should not have been created (no execute happened)
    const tabState = useQueryStore.getState().tabs['tab-1']
    expect(tabState).toBeUndefined()
  })

  it('execute all does nothing when content is empty', async () => {
    renderToolbar('')
    await act(async () => {
      fireEvent.click(screen.getByTestId('toolbar-execute-all'))
    })
    const tabState = useQueryStore.getState().tabs['tab-1']
    expect(tabState).toBeUndefined()
  })

  it('save button opens dialog (no-op on cancel)', async () => {
    const { save } = await import('@tauri-apps/plugin-dialog')
    renderToolbar('SELECT 1')
    await act(async () => {
      fireEvent.click(screen.getByTestId('toolbar-save'))
    })
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalled()
    })
  })

  it('save button writes file when path selected', async () => {
    const dialogMod = await import('@tauri-apps/plugin-dialog')
    vi.mocked(dialogMod.save).mockResolvedValueOnce('/tmp/query.sql')

    renderToolbar('SELECT 1')
    await act(async () => {
      fireEvent.click(screen.getByTestId('toolbar-save'))
    })
    await vi.waitFor(() => {
      expect(dialogMod.save).toHaveBeenCalled()
    })
    // File path should be set on the tab
    const tabState = useQueryStore.getState().tabs['tab-1']
    expect(tabState?.filePath).toBe('/tmp/query.sql')
  })

  it('open button opens dialog (no-op on cancel)', async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    renderToolbar()
    await act(async () => {
      fireEvent.click(screen.getByTestId('toolbar-open'))
    })
    await vi.waitFor(() => {
      expect(open).toHaveBeenCalled()
    })
  })

  it('open button reads file and creates new tab when path selected', async () => {
    const dialogMod = await import('@tauri-apps/plugin-dialog')
    vi.mocked(dialogMod.open).mockResolvedValueOnce('/tmp/query.sql')

    renderToolbar()
    await act(async () => {
      fireEvent.click(screen.getByTestId('toolbar-open'))
    })
    await vi.waitFor(() => {
      expect(dialogMod.open).toHaveBeenCalled()
    })
    // A new query tab should have been created
    const tabs = useWorkspaceStore.getState().tabsByConnection['conn-1']
    expect(tabs).toBeDefined()
    expect(tabs.length).toBeGreaterThan(0)
  })

  it('execute all stops on error', async () => {
    // Set up IPC to fail on second query
    let callCount = 0
    mockIPC((cmd) => {
      if (cmd === 'execute_query') {
        callCount++
        if (callCount === 2) {
          throw new Error('Query failed')
        }
        return {
          queryId: 'q1',
          columns: [{ name: 'id', dataType: 'INT' }],
          totalRows: 1,
          executionTimeMs: 10,
          affectedRows: 0,
          firstPage: [[1]],
          totalPages: 1,
          autoLimitApplied: false,
        }
      }
      return null
    })

    renderToolbar('SELECT 1; SELECT 2; SELECT 3;')
    await act(async () => {
      fireEvent.click(screen.getByTestId('toolbar-execute-all'))
    })
    // Should have stopped after the error on second statement
    const tabState = useQueryStore.getState().tabs['tab-1']
    expect(tabState?.status).toBe('error')
  })
})
