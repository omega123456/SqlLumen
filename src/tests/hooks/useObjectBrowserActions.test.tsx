import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  useObjectBrowserActions,
  type UseObjectBrowserActionsReturn,
} from '../../hooks/useObjectBrowserActions'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { resetWorkspaceStore } from '../helpers/workspace-test-utils'
import { useSchemaStore } from '../../stores/schema-store'
import { useToastStore } from '../../stores/toast-store'
import { ipc, expectToast } from '../ipc-mock'
import type { EditableObjectType } from '../../types/schema'
import { useQueryStore } from '../../stores/query-store'
import {
  getCachedRoutineParameters,
  getRoutineParameters as getRoutineParametersCache,
} from '../../components/query-editor/routine-parameter-cache'
import {
  getCache as getSchemaMetadataCache,
  hydrateFromSnapshot,
} from '../../components/query-editor/schema-metadata-cache'

const CONN_ID = 'conn-test'
const OLD_DB_NAME = 'old_db'
const OLD_ROUTINE_NAME = 'fn_old'

function buildOldDbSchemaSnapshot(): string {
  return JSON.stringify({
    databases: [OLD_DB_NAME],
    tables: { [OLD_DB_NAME]: [{ name: 'users', tableType: 'BASE TABLE' }] },
    columns: {},
    routines: {},
    foreignKeys: {},
    indexes: {},
  })
}

async function primeOldDbCaches(): Promise<void> {
  ipc.override('get_routine_parameters_with_return_type', () => ({
    found: true,
    parameters: [{ name: '', dataType: 'INT', mode: '', ordinalPosition: 0 }],
  }))
  await getRoutineParametersCache(CONN_ID, OLD_DB_NAME, OLD_ROUTINE_NAME, 'function')
  hydrateFromSnapshot(buildOldDbSchemaSnapshot(), CONN_ID)
}

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
  resetWorkspaceStore()
  useToastStore.setState({ toasts: [] })
  useSchemaStore.setState({
    connectionStates: {},
    refreshDatabase: vi.fn().mockResolvedValue(undefined),
    refreshAll: vi.fn().mockResolvedValue(undefined),
    refreshCategory: vi.fn().mockResolvedValue(undefined),
  })
  useQueryStore.setState({ tabs: {} })
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
        expect(ipc.calls('drop_object')).toContainEqual({
          connectionId: CONN_ID,
          database: 'testdb',
          objectName: 'my_view',
          objectType: 'view',
        })
      })

      expect(closeTabsByObject).toHaveBeenCalledWith(CONN_ID, 'testdb', 'my_view', 'view')

      const refreshCategory = useSchemaStore.getState().refreshCategory
      expect(refreshCategory).toHaveBeenCalledWith(CONN_ID, 'testdb', 'view')

      await expectToast('success', 'View dropped')
    })

    it('shows error toast on failure', async () => {
      const user = userEvent.setup()
      ipc.override('drop_object', () => {
        throw new Error('Permission denied')
      })

      const { result } = renderActions()

      act(() => {
        result.onDropObject('testdb', 'sp_test', 'procedure')
      })

      const confirmButton = screen.getByRole('button', { name: /Drop Procedure/i })
      await user.click(confirmButton)

      await expectToast('error', 'Permission denied')
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
      ipc.override('get_routine_parameters', () => [
        { name: 'p_id', dataType: 'INT', mode: 'IN', ordinalPosition: 1 },
        { name: 'p_result', dataType: 'VARCHAR(255)', mode: 'OUT', ordinalPosition: 2 },
      ])

      const { result } = renderActions()

      await act(async () => {
        result.onExecuteRoutine('testdb', 'my_proc', 'procedure')
      })

      expect(ipc.calls('get_routine_parameters')).toContainEqual({
        connectionId: CONN_ID,
        database: 'testdb',
        routineName: 'my_proc',
        routineType: 'procedure',
      })

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
      ipc.override('get_routine_parameters', () => [
        { name: 'p_input', dataType: 'VARCHAR(100)', mode: '', ordinalPosition: 1 },
      ])

      const { result } = renderActions()

      await act(async () => {
        result.onExecuteRoutine('testdb', 'my_func', 'function')
      })

      expect(ipc.calls('get_routine_parameters')).toContainEqual({
        connectionId: CONN_ID,
        database: 'testdb',
        routineName: 'my_func',
        routineType: 'function',
      })

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
      ipc.override('get_routine_parameters', () => {
        throw new Error('Connection lost')
      })

      const { result } = renderActions()

      await act(async () => {
        result.onExecuteRoutine('testdb', 'broken_proc', 'procedure')
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
      await expectToast('warning', 'Could not load parameters')
    })

    it('shows SELECT fallback template for function when IPC fails', async () => {
      ipc.override('get_routine_parameters', () => {
        throw new Error('Timeout')
      })

      const { result } = renderActions()

      await act(async () => {
        result.onExecuteRoutine('testdb', 'broken_func', 'function')
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
      ipc.override('get_routine_parameters', () => [])

      const { result } = renderActions()

      await act(async () => {
        result.onExecuteRoutine('testdb', 'simple_proc', 'procedure')
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
      await primeOldDbCaches()
      const { result } = renderActions()

      act(() => {
        result.onDropDatabase(OLD_DB_NAME)
      })

      const confirmButton = screen.getByRole('button', { name: /Drop Database/i })
      await user.click(confirmButton)

      await waitFor(() => {
        expect(ipc.calls('drop_database')).toContainEqual({
          connectionId: CONN_ID,
          name: OLD_DB_NAME,
        })
      })

      expect(getCachedRoutineParameters(CONN_ID, OLD_DB_NAME, OLD_ROUTINE_NAME)).toBeUndefined()
      expect(getSchemaMetadataCache(CONN_ID).databases).toEqual([])
      await expectToast('success', 'Database dropped')
    })

    it('does NOT invalidate caches when DB drop fails', async () => {
      const user = userEvent.setup()
      ipc.override('drop_database', () => {
        throw new Error('Permission denied')
      })
      await primeOldDbCaches()

      const { result } = renderActions()

      act(() => {
        result.onDropDatabase(OLD_DB_NAME)
      })

      const confirmButton = screen.getByRole('button', { name: /Drop Database/i })
      await user.click(confirmButton)

      await expectToast('error', 'Failed to drop database')

      expect(getCachedRoutineParameters(CONN_ID, OLD_DB_NAME, OLD_ROUTINE_NAME)).not.toBeUndefined()
      expect(getSchemaMetadataCache(CONN_ID).databases).toContain(OLD_DB_NAME)
    })
  })

  describe('handleRenameDatabase — cache invalidation', () => {
    it('invalidates routine and schema metadata caches after successful DB rename', async () => {
      const user = userEvent.setup()
      await primeOldDbCaches()
      const { result } = renderActions()

      act(() => {
        result.onRenameDatabase(OLD_DB_NAME)
      })

      // Type a new name in the rename input
      const input = screen.getByTestId('rename-name-input')
      await user.clear(input)
      await user.type(input, 'new_db')

      const confirmButton = screen.getByTestId('rename-confirm-button')
      await user.click(confirmButton)

      await waitFor(() => {
        expect(ipc.calls('rename_database')).toContainEqual({
          connectionId: CONN_ID,
          oldName: OLD_DB_NAME,
          newName: 'new_db',
        })
      })

      expect(getCachedRoutineParameters(CONN_ID, OLD_DB_NAME, OLD_ROUTINE_NAME)).toBeUndefined()
      expect(getSchemaMetadataCache(CONN_ID).databases).toEqual([])
      await expectToast('success', 'Database renamed')
    })

    it('does NOT invalidate caches when DB rename fails', async () => {
      const user = userEvent.setup()
      ipc.override('rename_database', () => {
        throw new Error('Access denied')
      })
      await primeOldDbCaches()

      const { result } = renderActions()

      act(() => {
        result.onRenameDatabase(OLD_DB_NAME)
      })

      const input = screen.getByTestId('rename-name-input')
      await user.clear(input)
      await user.type(input, 'new_db')

      const confirmButton = screen.getByTestId('rename-confirm-button')
      await user.click(confirmButton)

      await expectToast('error', 'Failed to rename database')

      expect(getCachedRoutineParameters(CONN_ID, OLD_DB_NAME, OLD_ROUTINE_NAME)).not.toBeUndefined()
      expect(getSchemaMetadataCache(CONN_ID).databases).toContain(OLD_DB_NAME)
    })
  })
})
