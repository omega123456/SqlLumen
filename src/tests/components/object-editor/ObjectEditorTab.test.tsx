import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ObjectEditorTab } from '../../../components/object-editor/ObjectEditorTab'
import { useObjectEditorStore } from '../../../stores/object-editor-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { ObjectEditorTab as ObjectEditorTabType } from '../../../types/schema'

// Mock IPC commands used by the object-editor store
vi.mock('../../../lib/object-editor-commands', () => ({
  getObjectBody: vi.fn().mockResolvedValue('CREATE PROCEDURE `app_db`.`my_proc`() BEGIN END'),
  saveObject: vi.fn().mockResolvedValue({
    success: true,
    errorMessage: null,
    dropSucceeded: false,
    savedObjectName: null,
  }),
  dropObject: vi.fn().mockResolvedValue(undefined),
  getRoutineParameters: vi.fn().mockResolvedValue([]),
}))

import { getObjectBody, saveObject } from '../../../lib/object-editor-commands'

function makeTab(overrides: Partial<ObjectEditorTabType> = {}): ObjectEditorTabType {
  return {
    id: 'tab-1',
    type: 'object-editor',
    label: 'Stored Procedure: my_proc',
    connectionId: 'conn-1',
    databaseName: 'app_db',
    objectName: 'my_proc',
    objectType: 'procedure',
    mode: 'alter',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useObjectEditorStore.setState({ tabs: {} })
  useWorkspaceStore.setState({ tabsByConnection: {}, activeTabByConnection: {} })
  vi.mocked(getObjectBody).mockResolvedValue('CREATE PROCEDURE `app_db`.`my_proc`() BEGIN END')
  vi.mocked(saveObject).mockResolvedValue({
    success: true,
    errorMessage: null,
    dropSucceeded: false,
    savedObjectName: null,
  })
})

describe('ObjectEditorTab', () => {
  it('renders loading state while isLoading', () => {
    useObjectEditorStore.setState({
      tabs: {
        'tab-1': {
          connectionId: 'conn-1',
          database: 'app_db',
          objectName: 'my_proc',
          objectType: 'procedure',
          mode: 'alter',
          content: '',
          originalContent: '',
          isLoading: true,
          isSaving: false,
          error: null,
          pendingNavigationAction: null,
          savedObjectName: null,
        },
      },
    })

    render(<ObjectEditorTab tab={makeTab()} />)
    expect(screen.getByTestId('object-editor-loading')).toBeInTheDocument()
  })

  it('renders error state when error is set and content is empty (load failure)', () => {
    useObjectEditorStore.setState({
      tabs: {
        'tab-1': {
          connectionId: 'conn-1',
          database: 'app_db',
          objectName: 'my_proc',
          objectType: 'procedure',
          mode: 'alter',
          content: '',
          originalContent: '',
          isLoading: false,
          isSaving: false,
          error: 'Something went wrong',
          pendingNavigationAction: null,
          savedObjectName: null,
        },
      },
    })

    render(<ObjectEditorTab tab={makeTab()} />)
    expect(screen.getByTestId('object-editor-error')).toHaveTextContent('Something went wrong')
  })

  it('keeps editor visible when error is set but content exists (save failure)', () => {
    useObjectEditorStore.setState({
      tabs: {
        'tab-1': {
          connectionId: 'conn-1',
          database: 'app_db',
          objectName: 'my_proc',
          objectType: 'procedure',
          mode: 'alter',
          content: 'CREATE PROCEDURE `my_proc`() BEGIN END',
          originalContent: 'CREATE PROCEDURE `my_proc`() BEGIN END',
          isLoading: false,
          isSaving: false,
          error: 'CREATE failed after DROP: syntax error',
          pendingNavigationAction: null,
          savedObjectName: null,
        },
      },
    })

    render(<ObjectEditorTab tab={makeTab()} />)
    // Editor should remain visible — no full-screen error
    expect(screen.queryByTestId('object-editor-error')).not.toBeInTheDocument()
    expect(screen.getByTestId('object-editor-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('monaco-editor-wrapper')).toBeInTheDocument()
  })

  it('renders toolbar and Monaco editor when loaded (alter mode)', async () => {
    render(<ObjectEditorTab tab={makeTab()} />)

    await waitFor(() => {
      expect(screen.getByTestId('object-editor-toolbar')).toBeInTheDocument()
    })
    expect(screen.getByTestId('monaco-editor-wrapper')).toBeInTheDocument()
    expect(screen.getByText('Stored Procedure: my_proc')).toBeInTheDocument()
  })

  it('renders template in create mode', async () => {
    render(
      <ObjectEditorTab
        tab={makeTab({
          mode: 'create',
          objectName: 'new_procedure',
          label: 'New Stored Procedure',
        })}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('object-editor-toolbar')).toBeInTheDocument()
    })
    expect(screen.getByText('New Stored Procedure')).toBeInTheDocument()
    // getObjectBody should NOT have been called in create mode
    expect(getObjectBody).not.toHaveBeenCalled()
  })

  it('save button click triggers saveBody', async () => {
    const user = userEvent.setup()
    useObjectEditorStore.setState({
      tabs: {
        'tab-1': {
          connectionId: 'conn-1',
          database: 'app_db',
          objectName: 'my_proc',
          objectType: 'procedure',
          mode: 'alter',
          content: 'modified content',
          originalContent: 'original content',
          isLoading: false,
          isSaving: false,
          error: null,
          pendingNavigationAction: null,
          savedObjectName: null,
        },
      },
    })

    render(<ObjectEditorTab tab={makeTab()} />)

    await user.click(screen.getByTestId('object-editor-save-button'))

    await waitFor(() => {
      expect(saveObject).toHaveBeenCalledWith(
        'conn-1',
        'app_db',
        'my_proc',
        'procedure',
        'modified content',
        'alter'
      )
    })
  })

  it('Ctrl+S keyboard shortcut is handled by the global shortcut system (not local handler)', async () => {
    // The Ctrl+S handler was removed from ObjectEditorTab — save is now wired
    // via AppLayout's registerAction('save-file'). Dispatching Ctrl+S on the
    // window should NOT trigger saveBody directly from ObjectEditorTab.
    useObjectEditorStore.setState({
      tabs: {
        'tab-1': {
          connectionId: 'conn-1',
          database: 'app_db',
          objectName: 'my_proc',
          objectType: 'procedure',
          mode: 'alter',
          content: 'modified content',
          originalContent: 'original content',
          isLoading: false,
          isSaving: false,
          error: null,
          pendingNavigationAction: null,
          savedObjectName: null,
        },
      },
    })

    render(<ObjectEditorTab tab={makeTab()} />)

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    })

    // saveObject should NOT have been called — no local handler exists anymore
    expect(saveObject).not.toHaveBeenCalled()
  })

  it('unsaved changes dialog appears when pendingNavigationAction is set', () => {
    useObjectEditorStore.setState({
      tabs: {
        'tab-1': {
          connectionId: 'conn-1',
          database: 'app_db',
          objectName: 'my_proc',
          objectType: 'procedure',
          mode: 'alter',
          content: 'modified',
          originalContent: 'original',
          isLoading: false,
          isSaving: false,
          error: null,
          pendingNavigationAction: vi.fn(),
          savedObjectName: null,
        },
      },
    })

    render(<ObjectEditorTab tab={makeTab()} />)
    expect(screen.getByText('Unsaved Changes')).toBeInTheDocument()
    expect(screen.getByTestId('unsaved-changes-dialog')).toBeInTheDocument()
  })

  it('after create-mode save, updateObjectEditorTab is called with savedObjectName', async () => {
    const user = userEvent.setup()
    vi.mocked(saveObject).mockResolvedValue({
      success: true,
      errorMessage: null,
      dropSucceeded: false,
      savedObjectName: 'my_new_proc',
    })

    // Set up workspace store with the tab
    useWorkspaceStore.getState().openTab({
      type: 'object-editor',
      label: 'New Stored Procedure',
      connectionId: 'conn-1',
      databaseName: 'app_db',
      objectName: 'new_procedure',
      objectType: 'procedure',
      mode: 'create',
    })

    const workspaceTab = useWorkspaceStore.getState().tabsByConnection[
      'conn-1'
    ][0] as ObjectEditorTabType
    const tabId = workspaceTab.id

    // Set up object editor store with dirty content in create mode
    useObjectEditorStore.setState({
      tabs: {
        [tabId]: {
          connectionId: 'conn-1',
          database: 'app_db',
          objectName: 'new_procedure',
          objectType: 'procedure',
          mode: 'create',
          content: 'CREATE PROCEDURE `app_db`.`my_new_proc`() BEGIN END',
          originalContent: 'CREATE PROCEDURE `app_db`.`procedure_name`() BEGIN END',
          isLoading: false,
          isSaving: false,
          error: null,
          pendingNavigationAction: null,
          savedObjectName: null,
        },
      },
    })

    render(<ObjectEditorTab tab={workspaceTab} />)

    await user.click(screen.getByTestId('object-editor-save-button'))

    await waitFor(() => {
      const updatedTab = useWorkspaceStore.getState().tabsByConnection[
        'conn-1'
      ][0] as ObjectEditorTabType
      expect(updatedTab.objectName).toBe('my_new_proc')
      expect(updatedTab.mode).toBe('alter')
      expect(updatedTab.label).toBe('Stored Procedure: my_new_proc')
    })
  })

  it('loading state shows loading indicator with data-testid', async () => {
    // Let getObjectBody never resolve to keep loading
    vi.mocked(getObjectBody).mockReturnValue(new Promise(() => {}))

    render(<ObjectEditorTab tab={makeTab()} />)

    await waitFor(() => {
      expect(screen.getByTestId('object-editor-loading')).toBeInTheDocument()
    })
  })

  it('discard button in unsaved dialog reverts content and executes pending action', async () => {
    const user = userEvent.setup()
    const pendingAction = vi.fn()

    useObjectEditorStore.setState({
      tabs: {
        'tab-1': {
          connectionId: 'conn-1',
          database: 'app_db',
          objectName: 'my_proc',
          objectType: 'procedure',
          mode: 'alter',
          content: 'modified',
          originalContent: 'original',
          isLoading: false,
          isSaving: false,
          error: null,
          pendingNavigationAction: pendingAction,
          savedObjectName: null,
        },
      },
    })

    render(<ObjectEditorTab tab={makeTab()} />)

    await user.click(screen.getByTestId('btn-discard-changes'))

    await waitFor(() => {
      expect(pendingAction).toHaveBeenCalledTimes(1)
    })
  })

  it('cancel button in unsaved dialog clears pending action', async () => {
    const user = userEvent.setup()
    const pendingAction = vi.fn()

    useObjectEditorStore.setState({
      tabs: {
        'tab-1': {
          connectionId: 'conn-1',
          database: 'app_db',
          objectName: 'my_proc',
          objectType: 'procedure',
          mode: 'alter',
          content: 'modified',
          originalContent: 'original',
          isLoading: false,
          isSaving: false,
          error: null,
          pendingNavigationAction: pendingAction,
          savedObjectName: null,
        },
      },
    })

    render(<ObjectEditorTab tab={makeTab()} />)

    await user.click(screen.getByTestId('btn-cancel-changes'))

    await waitFor(() => {
      expect(useObjectEditorStore.getState().tabs['tab-1']?.pendingNavigationAction).toBeNull()
    })
    expect(pendingAction).not.toHaveBeenCalled()
  })

  it('renders object-editor-tab data-testid', async () => {
    render(<ObjectEditorTab tab={makeTab()} />)

    await waitFor(() => {
      expect(screen.getByTestId('object-editor-tab')).toBeInTheDocument()
    })
  })
})
