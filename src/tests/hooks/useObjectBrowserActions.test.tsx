import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  useObjectBrowserActions,
  type UseObjectBrowserActionsReturn,
} from '../../hooks/useObjectBrowserActions'
import { useWorkspaceStore, _resetTabIdCounter } from '../../stores/workspace-store'
import { useSchemaStore } from '../../stores/schema-store'
import type { EditableObjectType } from '../../types/schema'

// Mock IPC commands
vi.mock('../../lib/schema-commands', () => ({
  dropDatabase: vi.fn().mockResolvedValue(undefined),
  dropTable: vi.fn().mockResolvedValue(undefined),
  truncateTable: vi.fn().mockResolvedValue(undefined),
  renameDatabase: vi.fn().mockResolvedValue(undefined),
  renameTable: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/object-editor-commands', () => ({
  dropObject: vi.fn().mockResolvedValue(undefined),
  getObjectBody: vi.fn().mockResolvedValue(''),
  saveObject: vi.fn().mockResolvedValue({ success: true }),
  getRoutineParameters: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../stores/toast-store', () => ({
  showSuccessToast: vi.fn(),
  showErrorToast: vi.fn(),
  showWarningToast: vi.fn(),
}))

vi.mock('../../components/query-editor/routine-parameter-cache', () => ({
  invalidateRoutineCache: vi.fn(),
}))

vi.mock('../../components/query-editor/schema-metadata-cache', () => ({
  invalidateCache: vi.fn(),
}))

import { dropObject, getRoutineParameters } from '../../lib/object-editor-commands'
import { showSuccessToast, showErrorToast, showWarningToast } from '../../stores/toast-store'
import { useQueryStore } from '../../stores/query-store'
import { invalidateRoutineCache } from '../../components/query-editor/routine-parameter-cache'
import { invalidateCache as invalidateSchemaMetadataCache } from '../../components/query-editor/schema-metadata-cache'
import { dropDatabase, renameDatabase } from '../../lib/schema-commands'

const CONN_ID = 'conn-test'

/**
 * Wrapper component that renders the dialogs returned by the hook
 * and exposes the hook return via a ref-like callback.
 */
function TestHarness({ onResult }: { onResult: (result: UseObjectBrowserActionsReturn) => void }) {
  const result = useObjectBrowserActions(CONN_ID)
  onResult(result)
  return <>{result.dialogs}</>
}

function renderActions() {
  let current: UseObjectBrowserActionsReturn = null!
  const { rerender } = render(<TestHarness onResult={(r) => (current = r)} />)
  return {
    get result() {
      return current
    },
    rerender: () => rerender(<TestHarness onResult={(r) => (current = r)} />),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetTabIdCounter()
  useSchemaStore.setState({
    connectionStates: {},
    refreshDatabase: vi.fn().mockResolvedValue(undefined),
    refreshAll: vi.fn().mockResolvedValue(undefined),
    refreshCategory: vi.fn().mockResolvedValue(undefined),
  })
  useWorkspaceStore.setState({
    tabsByConnection: {},
    activeTabByConnection: {},
  })
})

describe('useObjectBrowserActions — object editor actions', () => {
  describe('handleAlterObject', () => {
    it('opens object-editor tab in alter mode for view', () => {
      const { result } = renderActions()

      act(() => {
        result.onAlterObject('testdb', 'my_view', 'view')
      })

      const state = useWorkspaceStore.getState()
      const tabs = state.tabsByConnection[CONN_ID]
      expect(tabs).toHaveLength(1)
      expect(tabs[0]).toMatchObject({
        type: 'object-editor',
        connectionId: CONN_ID,
        databaseName: 'testdb',
        objectName: 'my_view',
        objectType: 'view',
        mode: 'alter',
      })
    })

    it('opens object-editor tab in alter mode for procedure', () => {
      const { result } = renderActions()

      act(() => {
        result.onAlterObject('testdb', 'sp_test', 'procedure')
      })

      const tabs = useWorkspaceStore.getState().tabsByConnection[CONN_ID]
      expect(tabs).toHaveLength(1)
      expect(tabs[0]).toMatchObject({
        type: 'object-editor',
        objectType: 'procedure',
        objectName: 'sp_test',
        mode: 'alter',
        label: 'Procedure: sp_test',
      })
    })

    it('opens object-editor tab in alter mode for function', () => {
      const { result } = renderActions()

      act(() => {
        result.onAlterObject('testdb', 'calc_total', 'function')
      })

      const tabs = useWorkspaceStore.getState().tabsByConnection[CONN_ID]
      expect(tabs).toHaveLength(1)
      expect(tabs[0]).toMatchObject({
        type: 'object-editor',
        objectType: 'function',
        objectName: 'calc_total',
        mode: 'alter',
        label: 'Function: calc_total',
      })
    })

    it('opens object-editor tab in alter mode for trigger', () => {
      const { result } = renderActions()

      act(() => {
        result.onAlterObject('testdb', 'before_insert', 'trigger')
      })

      const tabs = useWorkspaceStore.getState().tabsByConnection[CONN_ID]
      expect(tabs).toHaveLength(1)
      expect(tabs[0]).toMatchObject({
        type: 'object-editor',
        objectType: 'trigger',
        objectName: 'before_insert',
        mode: 'alter',
        label: 'Trigger: before_insert',
      })
    })

    it('opens object-editor tab in alter mode for event', () => {
      const { result } = renderActions()

      act(() => {
        result.onAlterObject('testdb', 'cleanup_job', 'event')
      })

      const tabs = useWorkspaceStore.getState().tabsByConnection[CONN_ID]
      expect(tabs).toHaveLength(1)
      expect(tabs[0]).toMatchObject({
        type: 'object-editor',
        objectType: 'event',
        objectName: 'cleanup_job',
        mode: 'alter',
        label: 'Event: cleanup_job',
      })
    })
  })

  describe('handleCreateObject', () => {
    const cases: Array<{ objectType: EditableObjectType; placeholder: string; label: string }> = [
      { objectType: 'procedure', placeholder: 'new_procedure', label: 'New Procedure' },
      { objectType: 'function', placeholder: 'new_function', label: 'New Function' },
      { objectType: 'trigger', placeholder: 'new_trigger', label: 'New Trigger' },
      { objectType: 'event', placeholder: 'new_event', label: 'New Event' },
      { objectType: 'view', placeholder: 'new_view', label: 'New View' },
    ]

    for (const { objectType, placeholder, label } of cases) {
      it(`opens object-editor tab in create mode for ${objectType}`, () => {
        const { result } = renderActions()

        act(() => {
          result.onCreateObject('testdb', objectType)
        })

        const tabs = useWorkspaceStore.getState().tabsByConnection[CONN_ID]
        expect(tabs).toHaveLength(1)
        expect(tabs[0]).toMatchObject({
          type: 'object-editor',
          connectionId: CONN_ID,
          databaseName: 'testdb',
          objectName: placeholder,
          objectType,
          mode: 'create',
          label,
        })
      })
    }
  })

  describe('handleDropObject', () => {
    it('sets drop confirm state', () => {
      const { result } = renderActions()

      act(() => {
        result.onDropObject('testdb', 'my_view', 'view')
      })

      // The confirmation dialog should now be visible
      expect(screen.getByText(/Are you sure you want to drop/)).toBeInTheDocument()
      expect(screen.getByText("'my_view'")).toBeInTheDocument()
      expect(screen.getByText("'testdb'")).toBeInTheDocument()
    })

    it('shows confirmation dialog with correct title for procedure', () => {
      const { result } = renderActions()

      act(() => {
        result.onDropObject('testdb', 'sp_test', 'procedure')
      })

      // The dialog should be visible — title appears in both h2 and button,
      // so use getAllByText
      const matches = screen.getAllByText('Drop Procedure')
      expect(matches.length).toBeGreaterThanOrEqual(1)
      // Also verify the confirm dialog is rendered
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    })

    it('calls dropObject IPC on confirm, closes tabs, refreshes schema, shows toast', async () => {
      const user = userEvent.setup()
      const closeTabsByObject = vi.fn()
      useWorkspaceStore.setState({ closeTabsByObject })

      const { result } = renderActions()

      act(() => {
        result.onDropObject('testdb', 'my_view', 'view')
      })

      // Confirm the drop
      const confirmButton = screen.getByRole('button', { name: /Drop View/i })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(dropObject).toHaveBeenCalledWith(CONN_ID, 'testdb', 'my_view', 'view')
      })

      expect(closeTabsByObject).toHaveBeenCalledWith(CONN_ID, 'testdb', 'my_view', 'view')

      const refreshCategory = useSchemaStore.getState().refreshCategory
      expect(refreshCategory).toHaveBeenCalledWith(CONN_ID, 'testdb', 'view')

      expect(showSuccessToast).toHaveBeenCalledWith('View dropped', 'testdb.my_view')
    })

    it('shows error toast on failure', async () => {
      const user = userEvent.setup()
      vi.mocked(dropObject).mockRejectedValueOnce(new Error('Permission denied'))

      const { result } = renderActions()

      act(() => {
        result.onDropObject('testdb', 'sp_test', 'procedure')
      })

      const confirmButton = screen.getByRole('button', { name: /Drop Procedure/i })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(showErrorToast).toHaveBeenCalledWith('Failed to drop procedure', 'Permission denied')
      })
    })

    it('falls back to refreshDatabase when refreshCategory fails', async () => {
      const user = userEvent.setup()
      const refreshCategory = vi.fn().mockRejectedValue(new Error('Category not found'))
      const refreshDatabase = vi.fn().mockResolvedValue(undefined)
      useSchemaStore.setState({ refreshCategory, refreshDatabase })

      const { result } = renderActions()

      act(() => {
        result.onDropObject('testdb', 'my_trigger', 'trigger')
      })

      const confirmButton = screen.getByRole('button', { name: /Drop Trigger/i })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(refreshDatabase).toHaveBeenCalledWith(CONN_ID, 'testdb')
      })
    })

    it('works for all 5 object types', () => {
      const types: EditableObjectType[] = ['view', 'procedure', 'function', 'trigger', 'event']
      const typeLabels: Record<EditableObjectType, string> = {
        view: 'View',
        procedure: 'Procedure',
        function: 'Function',
        trigger: 'Trigger',
        event: 'Event',
      }

      for (const objectType of types) {
        const { result } = renderActions()

        act(() => {
          result.onDropObject('testdb', `test_${objectType}`, objectType)
        })

        const matches = screen.getAllByText(`Drop ${typeLabels[objectType]}`)
        expect(matches.length).toBeGreaterThanOrEqual(1)

        // Cancel the dialog for cleanup
        act(() => {
          screen.getByTestId('confirm-cancel-button').click()
        })
      }
    })
  })

  describe('handleExecuteRoutine', () => {
    it('calls getRoutineParameters, builds template, opens query tab for procedure', async () => {
      vi.mocked(getRoutineParameters).mockResolvedValueOnce([
        { name: 'p_id', dataType: 'INT', mode: 'IN', ordinalPosition: 1 },
        { name: 'p_result', dataType: 'VARCHAR(255)', mode: 'OUT', ordinalPosition: 2 },
      ])

      const { result } = renderActions()

      await act(async () => {
        await result.onExecuteRoutine('testdb', 'my_proc', 'procedure')
      })

      expect(getRoutineParameters).toHaveBeenCalledWith(CONN_ID, 'testdb', 'my_proc', 'procedure')

      // A query tab should be opened
      const state = useWorkspaceStore.getState()
      const tabs = state.tabsByConnection[CONN_ID]
      expect(tabs).toHaveLength(1)
      expect(tabs[0]).toMatchObject({
        type: 'query-editor',
        label: 'Execute: my_proc',
      })

      // The query store should have the template content
      const tabId = tabs[0].id
      const queryState = useQueryStore.getState().tabs[tabId]
      expect(queryState).toBeDefined()
      expect(queryState.content).toContain('CALL `testdb`.`my_proc`(')
      expect(queryState.content).toContain('/* IN p_id int */ NULL')
      expect(queryState.content).toContain('/* OUT p_result varchar(255) */ @p_result')
    })

    it('builds SELECT template for function', async () => {
      vi.mocked(getRoutineParameters).mockResolvedValueOnce([
        { name: 'p_input', dataType: 'VARCHAR(100)', mode: '', ordinalPosition: 1 },
      ])

      const { result } = renderActions()

      await act(async () => {
        await result.onExecuteRoutine('testdb', 'my_func', 'function')
      })

      expect(getRoutineParameters).toHaveBeenCalledWith(CONN_ID, 'testdb', 'my_func', 'function')

      const state = useWorkspaceStore.getState()
      const tabs = state.tabsByConnection[CONN_ID]
      expect(tabs).toHaveLength(1)
      expect(tabs[0].label).toBe('Execute: my_func')

      const tabId = tabs[0].id
      const queryState = useQueryStore.getState().tabs[tabId]
      expect(queryState.content).toContain('SELECT `testdb`.`my_func`(')
      expect(queryState.content).toContain('/* p_input varchar(100) */ NULL')
    })

    it('shows warning toast and opens simple template when getRoutineParameters fails', async () => {
      vi.mocked(getRoutineParameters).mockRejectedValueOnce(new Error('Connection lost'))

      const { result } = renderActions()

      await act(async () => {
        await result.onExecuteRoutine('testdb', 'broken_proc', 'procedure')
      })

      // Should still open a tab
      const state = useWorkspaceStore.getState()
      const tabs = state.tabsByConnection[CONN_ID]
      expect(tabs).toHaveLength(1)
      expect(tabs[0].label).toBe('Execute: broken_proc')

      // Should use fallback template
      const tabId = tabs[0].id
      const queryState = useQueryStore.getState().tabs[tabId]
      expect(queryState.content).toContain(
        'CALL `testdb`.`broken_proc`( /* Add parameters here */ );'
      )

      // Should show warning toast
      expect(showWarningToast).toHaveBeenCalledWith(
        'Could not load parameters',
        'Showing basic template'
      )
    })

    it('shows SELECT fallback template for function when IPC fails', async () => {
      vi.mocked(getRoutineParameters).mockRejectedValueOnce(new Error('Timeout'))

      const { result } = renderActions()

      await act(async () => {
        await result.onExecuteRoutine('testdb', 'broken_func', 'function')
      })

      const state = useWorkspaceStore.getState()
      const tabs = state.tabsByConnection[CONN_ID]
      const tabId = tabs[0].id
      const queryState = useQueryStore.getState().tabs[tabId]
      expect(queryState.content).toContain(
        'SELECT `testdb`.`broken_func`( /* Add parameters here */ );'
      )
    })

    it('opens query tab with no-params template for procedure with empty params', async () => {
      vi.mocked(getRoutineParameters).mockResolvedValueOnce([])

      const { result } = renderActions()

      await act(async () => {
        await result.onExecuteRoutine('testdb', 'simple_proc', 'procedure')
      })

      const state = useWorkspaceStore.getState()
      const tabs = state.tabsByConnection[CONN_ID]
      const tabId = tabs[0].id
      const queryState = useQueryStore.getState().tabs[tabId]
      expect(queryState.content).toBe('CALL `testdb`.`simple_proc`();')
    })
  })

  describe('handleDropDatabase — cache invalidation', () => {
    it('invalidates routine and schema metadata caches after successful DB drop', async () => {
      const user = userEvent.setup()
      const { result } = renderActions()

      act(() => {
        result.onDropDatabase('old_db')
      })

      const confirmButton = screen.getByRole('button', { name: /Drop Database/i })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(dropDatabase).toHaveBeenCalledWith(CONN_ID, 'old_db')
      })

      expect(invalidateRoutineCache).toHaveBeenCalledWith(CONN_ID)
      expect(invalidateSchemaMetadataCache).toHaveBeenCalledWith(CONN_ID)
      expect(showSuccessToast).toHaveBeenCalledWith('Database dropped', 'old_db')
    })

    it('does NOT invalidate caches when DB drop fails', async () => {
      const user = userEvent.setup()
      vi.mocked(dropDatabase).mockRejectedValueOnce(new Error('Permission denied'))

      const { result } = renderActions()

      act(() => {
        result.onDropDatabase('old_db')
      })

      const confirmButton = screen.getByRole('button', { name: /Drop Database/i })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(showErrorToast).toHaveBeenCalled()
      })

      expect(invalidateRoutineCache).not.toHaveBeenCalled()
      expect(invalidateSchemaMetadataCache).not.toHaveBeenCalled()
    })
  })

  describe('handleRenameDatabase — cache invalidation', () => {
    it('invalidates routine and schema metadata caches after successful DB rename', async () => {
      const user = userEvent.setup()
      const { result } = renderActions()

      act(() => {
        result.onRenameDatabase('old_db')
      })

      // Type a new name in the rename input
      const input = screen.getByTestId('rename-name-input')
      await user.clear(input)
      await user.type(input, 'new_db')

      const confirmButton = screen.getByTestId('rename-confirm-button')
      await user.click(confirmButton)

      await waitFor(() => {
        expect(renameDatabase).toHaveBeenCalledWith(CONN_ID, 'old_db', 'new_db')
      })

      expect(invalidateRoutineCache).toHaveBeenCalledWith(CONN_ID)
      expect(invalidateSchemaMetadataCache).toHaveBeenCalledWith(CONN_ID)
      expect(showSuccessToast).toHaveBeenCalledWith('Database renamed', 'old_db → new_db')
    })

    it('does NOT invalidate caches when DB rename fails', async () => {
      const user = userEvent.setup()
      vi.mocked(renameDatabase).mockRejectedValueOnce(new Error('Access denied'))

      const { result } = renderActions()

      act(() => {
        result.onRenameDatabase('old_db')
      })

      const input = screen.getByTestId('rename-name-input')
      await user.clear(input)
      await user.type(input, 'new_db')

      const confirmButton = screen.getByTestId('rename-confirm-button')
      await user.click(confirmButton)

      await waitFor(() => {
        expect(showErrorToast).toHaveBeenCalled()
      })

      expect(invalidateRoutineCache).not.toHaveBeenCalled()
      expect(invalidateSchemaMetadataCache).not.toHaveBeenCalled()
    })
  })
})
