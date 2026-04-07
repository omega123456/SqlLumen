import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { AppLayout } from '../../components/layout/AppLayout'
import { useConnectionStore } from '../../stores/connection-store'
import { useShortcutStore } from '../../stores/shortcut-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useQueryStore } from '../../stores/query-store'
import { useObjectEditorStore } from '../../stores/object-editor-store'

beforeEach(() => {
  useConnectionStore.setState({
    activeConnections: {},
    activeTabId: null,
    dialogOpen: false,
    error: null,
  })
  // Reset shortcut store actions
  useShortcutStore.getState()._actions = {}
  // Reset workspace store
  useWorkspaceStore.setState({
    tabsByConnection: {},
    activeTabByConnection: {},
  })
})

describe('AppLayout', () => {
  it('renders all four main sections', () => {
    render(<AppLayout />)
    // Status bar
    expect(screen.getByText('Ready')).toBeInTheDocument()
    // Sidebar empty state
    expect(screen.getByText('No active connection')).toBeInTheDocument()
    // Workspace welcome
    expect(screen.getByText('Welcome!')).toBeInTheDocument()
  })

  it('renders the theme toggle button', () => {
    render(<AppLayout />)
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument()
  })

  it('renders the New Connection button in workspace', () => {
    render(<AppLayout />)
    expect(screen.getByText('+ New Connection')).toBeInTheDocument()
  })

  describe('shortcut action registrations', () => {
    it('registers all 7 shortcut actions on mount', () => {
      render(<AppLayout />)
      const actions = useShortcutStore.getState()._actions
      expect(actions['execute-query']).toBeTypeOf('function')
      expect(actions['execute-all']).toBeTypeOf('function')
      expect(actions['format-query']).toBeTypeOf('function')
      expect(actions['save-file']).toBeTypeOf('function')
      expect(actions['new-query-tab']).toBeTypeOf('function')
      expect(actions['close-tab']).toBeTypeOf('function')
      expect(actions['settings']).toBeTypeOf('function')
    })

    it('unregisters all actions on unmount', () => {
      const { unmount } = render(<AppLayout />)
      unmount()
      const actions = useShortcutStore.getState()._actions
      expect(actions['execute-query']).toBeUndefined()
      expect(actions['execute-all']).toBeUndefined()
      expect(actions['format-query']).toBeUndefined()
      expect(actions['save-file']).toBeUndefined()
      expect(actions['new-query-tab']).toBeUndefined()
      expect(actions['close-tab']).toBeUndefined()
      expect(actions['settings']).toBeUndefined()
    })
  })

  describe('execute-query action', () => {
    it('does nothing when there is no active connection', () => {
      render(<AppLayout />)
      const executeQuery = vi.fn()
      useQueryStore.setState({ executeQuery } as never)

      act(() => {
        useShortcutStore.getState().dispatchAction('execute-query')
      })

      expect(executeQuery).not.toHaveBeenCalled()
    })

    it('does nothing when active tab is not a query-editor', () => {
      useConnectionStore.setState({ activeTabId: 'conn-1' })
      useWorkspaceStore.setState({
        tabsByConnection: {
          'conn-1': [
            {
              id: 'tab-1',
              type: 'schema-info',
              connectionId: 'conn-1',
              label: 'Schema',
              databaseName: 'test',
              objectName: 'users',
              objectType: 'table',
            },
          ],
        },
        activeTabByConnection: { 'conn-1': 'tab-1' },
      })

      render(<AppLayout />)
      const executeQuery = vi.fn()
      useQueryStore.setState({ executeQuery } as never)

      act(() => {
        useShortcutStore.getState().dispatchAction('execute-query')
      })

      expect(executeQuery).not.toHaveBeenCalled()
    })

    it('executes the query at cursor position for a query-editor tab', () => {
      useConnectionStore.setState({ activeTabId: 'conn-1' })
      useWorkspaceStore.setState({
        tabsByConnection: {
          'conn-1': [{ id: 'tab-1', type: 'query-editor', connectionId: 'conn-1', label: 'Q1' }],
        },
        activeTabByConnection: { 'conn-1': 'tab-1' },
      })
      const executeQueryMock = vi.fn()
      const requestNavigationActionMock = vi.fn((_tabId: string, action: () => void) => action())
      useQueryStore.setState({
        tabs: {
          'tab-1': {
            content: 'SELECT 1;\nSELECT 2;',
            cursorPosition: { lineNumber: 1, column: 1 },
            status: 'idle',
            results: [],
          },
        },
        executeQuery: executeQueryMock,
        executeCallQuery: vi.fn(),
        requestNavigationAction: requestNavigationActionMock,
      } as never)

      render(<AppLayout />)

      act(() => {
        useShortcutStore.getState().dispatchAction('execute-query')
      })

      expect(requestNavigationActionMock).toHaveBeenCalledWith('tab-1', expect.any(Function))
      expect(executeQueryMock).toHaveBeenCalledWith('conn-1', 'tab-1', 'SELECT 1')
    })

    it('does not execute when tab status is running', () => {
      useConnectionStore.setState({ activeTabId: 'conn-1' })
      useWorkspaceStore.setState({
        tabsByConnection: {
          'conn-1': [{ id: 'tab-1', type: 'query-editor', connectionId: 'conn-1', label: 'Q1' }],
        },
        activeTabByConnection: { 'conn-1': 'tab-1' },
      })
      const executeQueryMock = vi.fn()
      useQueryStore.setState({
        tabs: {
          'tab-1': {
            content: 'SELECT 1',
            cursorPosition: { lineNumber: 1, column: 1 },
            status: 'running',
            results: [],
          },
        },
        executeQuery: executeQueryMock,
        requestNavigationAction: vi.fn(),
      } as never)

      render(<AppLayout />)

      act(() => {
        useShortcutStore.getState().dispatchAction('execute-query')
      })

      expect(executeQueryMock).not.toHaveBeenCalled()
    })

    it('does not execute when content is empty', () => {
      useConnectionStore.setState({ activeTabId: 'conn-1' })
      useWorkspaceStore.setState({
        tabsByConnection: {
          'conn-1': [{ id: 'tab-1', type: 'query-editor', connectionId: 'conn-1', label: 'Q1' }],
        },
        activeTabByConnection: { 'conn-1': 'tab-1' },
      })
      const executeQueryMock = vi.fn()
      useQueryStore.setState({
        tabs: {
          'tab-1': {
            content: '   ',
            cursorPosition: { lineNumber: 1, column: 1 },
            status: 'idle',
            results: [],
          },
        },
        executeQuery: executeQueryMock,
        requestNavigationAction: vi.fn(),
      } as never)

      render(<AppLayout />)

      act(() => {
        useShortcutStore.getState().dispatchAction('execute-query')
      })

      expect(executeQueryMock).not.toHaveBeenCalled()
    })

    it('uses executeCallQuery for CALL statements', () => {
      useConnectionStore.setState({ activeTabId: 'conn-1' })
      useWorkspaceStore.setState({
        tabsByConnection: {
          'conn-1': [{ id: 'tab-1', type: 'query-editor', connectionId: 'conn-1', label: 'Q1' }],
        },
        activeTabByConnection: { 'conn-1': 'tab-1' },
      })
      const executeCallQueryMock = vi.fn()
      const requestNavigationActionMock = vi.fn((_tabId: string, action: () => void) => action())
      useQueryStore.setState({
        tabs: {
          'tab-1': {
            content: 'CALL my_proc()',
            cursorPosition: { lineNumber: 1, column: 1 },
            status: 'idle',
            results: [],
          },
        },
        executeQuery: vi.fn(),
        executeCallQuery: executeCallQueryMock,
        requestNavigationAction: requestNavigationActionMock,
      } as never)

      render(<AppLayout />)

      act(() => {
        useShortcutStore.getState().dispatchAction('execute-query')
      })

      expect(executeCallQueryMock).toHaveBeenCalledWith('conn-1', 'tab-1', 'CALL my_proc()')
    })
  })

  describe('execute-all action', () => {
    it('executes all statements via executeMultiQuery', () => {
      useConnectionStore.setState({ activeTabId: 'conn-1' })
      useWorkspaceStore.setState({
        tabsByConnection: {
          'conn-1': [{ id: 'tab-1', type: 'query-editor', connectionId: 'conn-1', label: 'Q1' }],
        },
        activeTabByConnection: { 'conn-1': 'tab-1' },
      })
      const executeMultiQueryMock = vi.fn()
      const requestNavigationActionMock = vi.fn((_tabId: string, action: () => void) => action())
      useQueryStore.setState({
        tabs: {
          'tab-1': {
            content: 'SELECT 1;\nSELECT 2;',
            cursorPosition: { lineNumber: 1, column: 1 },
            status: 'idle',
            results: [],
          },
        },
        executeMultiQuery: executeMultiQueryMock,
        requestNavigationAction: requestNavigationActionMock,
      } as never)

      render(<AppLayout />)

      act(() => {
        useShortcutStore.getState().dispatchAction('execute-all')
      })

      expect(requestNavigationActionMock).toHaveBeenCalledWith('tab-1', expect.any(Function))
      expect(executeMultiQueryMock).toHaveBeenCalledWith('conn-1', 'tab-1', [
        'SELECT 1',
        'SELECT 2',
      ])
    })

    it('does nothing when content is empty', () => {
      useConnectionStore.setState({ activeTabId: 'conn-1' })
      useWorkspaceStore.setState({
        tabsByConnection: {
          'conn-1': [{ id: 'tab-1', type: 'query-editor', connectionId: 'conn-1', label: 'Q1' }],
        },
        activeTabByConnection: { 'conn-1': 'tab-1' },
      })
      const executeMultiQueryMock = vi.fn()
      useQueryStore.setState({
        tabs: {
          'tab-1': {
            content: '   ',
            status: 'idle',
            results: [],
          },
        },
        executeMultiQuery: executeMultiQueryMock,
        requestNavigationAction: vi.fn(),
      } as never)

      render(<AppLayout />)

      act(() => {
        useShortcutStore.getState().dispatchAction('execute-all')
      })

      expect(executeMultiQueryMock).not.toHaveBeenCalled()
    })
  })

  describe('format-query action', () => {
    it('formats the SQL content of the active query-editor tab', () => {
      useConnectionStore.setState({ activeTabId: 'conn-1' })
      useWorkspaceStore.setState({
        tabsByConnection: {
          'conn-1': [{ id: 'tab-1', type: 'query-editor', connectionId: 'conn-1', label: 'Q1' }],
        },
        activeTabByConnection: { 'conn-1': 'tab-1' },
      })
      const setContentMock = vi.fn()
      useQueryStore.setState({
        tabs: {
          'tab-1': {
            content: 'select 1',
            status: 'idle',
            results: [],
          },
        },
        setContent: setContentMock,
      } as never)

      render(<AppLayout />)

      act(() => {
        useShortcutStore.getState().dispatchAction('format-query')
      })

      expect(setContentMock).toHaveBeenCalledWith('tab-1', expect.stringContaining('select'))
    })

    it('does nothing when content is empty', () => {
      useConnectionStore.setState({ activeTabId: 'conn-1' })
      useWorkspaceStore.setState({
        tabsByConnection: {
          'conn-1': [{ id: 'tab-1', type: 'query-editor', connectionId: 'conn-1', label: 'Q1' }],
        },
        activeTabByConnection: { 'conn-1': 'tab-1' },
      })
      const setContentMock = vi.fn()
      useQueryStore.setState({
        tabs: {
          'tab-1': {
            content: '   ',
            status: 'idle',
            results: [],
          },
        },
        setContent: setContentMock,
      } as never)

      render(<AppLayout />)

      act(() => {
        useShortcutStore.getState().dispatchAction('format-query')
      })

      expect(setContentMock).not.toHaveBeenCalled()
    })

    it('does nothing when there is no active tab', () => {
      useConnectionStore.setState({ activeTabId: 'conn-1' })
      useWorkspaceStore.setState({
        tabsByConnection: { 'conn-1': [] },
        activeTabByConnection: { 'conn-1': null },
      })
      const setContentMock = vi.fn()
      useQueryStore.setState({ setContent: setContentMock } as never)

      render(<AppLayout />)

      act(() => {
        useShortcutStore.getState().dispatchAction('format-query')
      })

      expect(setContentMock).not.toHaveBeenCalled()
    })
  })

  describe('save-file action', () => {
    it('calls saveBody for dirty object-editor tabs', () => {
      useConnectionStore.setState({ activeTabId: 'conn-1' })
      useWorkspaceStore.setState({
        tabsByConnection: {
          'conn-1': [
            {
              id: 'tab-1',
              type: 'object-editor',
              connectionId: 'conn-1',
              label: 'myview',
              databaseName: 'test',
              objectName: 'myview',
              objectType: 'view',
              mode: 'alter',
            },
          ],
        },
        activeTabByConnection: { 'conn-1': 'tab-1' },
      })
      const saveBodyMock = vi.fn(() => Promise.resolve())
      useObjectEditorStore.setState({
        tabs: {
          'tab-1': {
            content: 'CREATE VIEW myview AS SELECT 2',
            originalContent: 'CREATE VIEW myview AS SELECT 1',
            isSaving: false,
            error: null,
          },
        },
        saveBody: saveBodyMock,
      } as never)

      render(<AppLayout />)

      act(() => {
        useShortcutStore.getState().dispatchAction('save-file')
      })

      expect(saveBodyMock).toHaveBeenCalledWith('tab-1')
    })

    it('does not call saveBody when content matches originalContent', () => {
      useConnectionStore.setState({ activeTabId: 'conn-1' })
      useWorkspaceStore.setState({
        tabsByConnection: {
          'conn-1': [
            {
              id: 'tab-1',
              type: 'object-editor',
              connectionId: 'conn-1',
              label: 'myview',
              databaseName: 'test',
              objectName: 'myview',
              objectType: 'view',
              mode: 'alter',
            },
          ],
        },
        activeTabByConnection: { 'conn-1': 'tab-1' },
      })
      const saveBodyMock = vi.fn(() => Promise.resolve())
      useObjectEditorStore.setState({
        tabs: {
          'tab-1': {
            content: 'same content',
            originalContent: 'same content',
            isSaving: false,
            error: null,
          },
        },
        saveBody: saveBodyMock,
      } as never)

      render(<AppLayout />)

      act(() => {
        useShortcutStore.getState().dispatchAction('save-file')
      })

      expect(saveBodyMock).not.toHaveBeenCalled()
    })

    it('does not call saveBody when tab is already saving', () => {
      useConnectionStore.setState({ activeTabId: 'conn-1' })
      useWorkspaceStore.setState({
        tabsByConnection: {
          'conn-1': [
            {
              id: 'tab-1',
              type: 'object-editor',
              connectionId: 'conn-1',
              label: 'myview',
              databaseName: 'test',
              objectName: 'myview',
              objectType: 'view',
              mode: 'alter',
            },
          ],
        },
        activeTabByConnection: { 'conn-1': 'tab-1' },
      })
      const saveBodyMock = vi.fn(() => Promise.resolve())
      useObjectEditorStore.setState({
        tabs: {
          'tab-1': {
            content: 'changed',
            originalContent: 'original',
            isSaving: true,
            error: null,
          },
        },
        saveBody: saveBodyMock,
      } as never)

      render(<AppLayout />)

      act(() => {
        useShortcutStore.getState().dispatchAction('save-file')
      })

      expect(saveBodyMock).not.toHaveBeenCalled()
    })
  })

  describe('new-query-tab action', () => {
    it('opens a new query tab for the active connection', () => {
      useConnectionStore.setState({ activeTabId: 'conn-1' })
      const openQueryTabMock = vi.fn(() => 'tab-new')
      useWorkspaceStore.setState({
        tabsByConnection: { 'conn-1': [] },
        activeTabByConnection: { 'conn-1': null },
        openQueryTab: openQueryTabMock,
      } as never)

      render(<AppLayout />)

      act(() => {
        useShortcutStore.getState().dispatchAction('new-query-tab')
      })

      expect(openQueryTabMock).toHaveBeenCalledWith('conn-1')
    })

    it('does nothing when there is no active connection', () => {
      const openQueryTabMock = vi.fn(() => 'tab-new')
      useWorkspaceStore.setState({ openQueryTab: openQueryTabMock } as never)

      render(<AppLayout />)

      act(() => {
        useShortcutStore.getState().dispatchAction('new-query-tab')
      })

      expect(openQueryTabMock).not.toHaveBeenCalled()
    })
  })

  describe('close-tab action', () => {
    it('closes the active tab for the active connection', () => {
      useConnectionStore.setState({ activeTabId: 'conn-1' })
      const closeTabMock = vi.fn()
      useWorkspaceStore.setState({
        tabsByConnection: {
          'conn-1': [{ id: 'tab-1', type: 'query-editor', connectionId: 'conn-1', label: 'Q1' }],
        },
        activeTabByConnection: { 'conn-1': 'tab-1' },
        closeTab: closeTabMock,
      } as never)

      render(<AppLayout />)

      act(() => {
        useShortcutStore.getState().dispatchAction('close-tab')
      })

      expect(closeTabMock).toHaveBeenCalledWith('conn-1', 'tab-1')
    })

    it('does nothing when there is no active tab', () => {
      useConnectionStore.setState({ activeTabId: 'conn-1' })
      const closeTabMock = vi.fn()
      useWorkspaceStore.setState({
        tabsByConnection: { 'conn-1': [] },
        activeTabByConnection: { 'conn-1': null },
        closeTab: closeTabMock,
      } as never)

      render(<AppLayout />)

      act(() => {
        useShortcutStore.getState().dispatchAction('close-tab')
      })

      expect(closeTabMock).not.toHaveBeenCalled()
    })
  })

  describe('settings action', () => {
    it('opens the settings dialog', async () => {
      render(<AppLayout />)

      // Settings dialog should not be open initially
      expect(screen.queryByText('Settings')).not.toBeInTheDocument()

      act(() => {
        useShortcutStore.getState().dispatchAction('settings')
      })

      await waitFor(() => {
        // SettingsDialog renders with a heading
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })
    })
  })
})
