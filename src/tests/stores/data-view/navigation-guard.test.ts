import { getActiveResult } from '../../../stores/query-store'
import { describe, it, expect, vi } from 'vitest'
import { useQueryStore, activeQuerySurfaceRef } from '../../../stores/query-store'
import { flat } from '../../helpers/query-test-utils'
import { ipc, expectToast } from '../../ipc-mock'
import {
  executeAndAnalyze,
  mockAnalyzeResult,
  mockTableColumns,
  registerQueryEditStoreSetup,
} from '../../helpers/query-store-fixtures'

registerQueryEditStoreSetup()

// ---------------------------------------------------------------------------
// requestNavigationAction
// ---------------------------------------------------------------------------

describe('requestNavigationAction', () => {
  it('executes action immediately when no pending edits', async () => {
    await executeAndAnalyze()
    const action = vi.fn()
    useQueryStore.getState().requestNavigationAction(activeQuerySurfaceRef('tab-1'), action)
    expect(action).toHaveBeenCalledOnce()
  })

  it('executes immediately and clears editState when editState has no modifications', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    // No modifications

    const action = vi.fn()
    useQueryStore.getState().requestNavigationAction(activeQuerySurfaceRef('tab-1'), action)
    expect(action).toHaveBeenCalledOnce()

    // Edit state should be discarded since dataset is changing
    const tab = flat('tab-1')
    expect(tab.view.edit.state).toBeNull()
    expect(tab.view.edit.rowIndex).toBeNull()
  })

  it('defers action when there are pending edits', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().updateCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Changed')

    const action = vi.fn()
    useQueryStore.getState().requestNavigationAction(activeQuerySurfaceRef('tab-1'), action)
    expect(action).not.toHaveBeenCalled()
    expect(
      getActiveResult(useQueryStore.getState().getTabState('tab-1')).view.prompts.pendingNavigation
    ).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// confirmNavigation
// ---------------------------------------------------------------------------

describe('confirmNavigation', () => {
  it('saves and executes pending action when shouldSave is true', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().updateCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Saved')

    const action = vi.fn()
    useQueryStore.getState().requestNavigationAction(activeQuerySurfaceRef('tab-1'), action)
    expect(action).not.toHaveBeenCalled()

    await useQueryStore.getState().confirmNavigation(activeQuerySurfaceRef('tab-1'), true)
    expect(action).toHaveBeenCalledOnce()
    expect(
      getActiveResult(useQueryStore.getState().getTabState('tab-1')).view.prompts.pendingNavigation
    ).toBeNull()
  })

  it('keeps the edit and the pending action when a date value is invalid', async () => {
    const datedColumns = mockTableColumns.map((column) =>
      column.name === 'name' ? { ...column, dataType: 'DATE' } : column
    )
    ipc.override('analyze_query_for_edit', () => [
      { ...mockAnalyzeResult[0], columns: datedColumns },
    ])
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().updateCellValue(activeQuerySurfaceRef('tab-1'), 1, 'not a date')
    const action = vi.fn()
    useQueryStore.getState().requestNavigationAction(activeQuerySurfaceRef('tab-1'), action)

    await useQueryStore.getState().confirmNavigation(activeQuerySurfaceRef('tab-1'), true)

    expect(action).not.toHaveBeenCalled()
    expect(ipc.calls('update_table_row')).toHaveLength(0)
    expect(flat('tab-1').view.edit.state?.currentValues.name).toBe('not a date')
    await expectToast('error', 'Invalid date value')
  })

  it('discards and executes pending action when shouldSave is false', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().syncCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Discardable')

    const action = vi.fn()
    useQueryStore.getState().requestNavigationAction(activeQuerySurfaceRef('tab-1'), action)

    await useQueryStore.getState().confirmNavigation(activeQuerySurfaceRef('tab-1'), false)
    expect(action).toHaveBeenCalledOnce()
    expect(flat('tab-1').rows[0][1]).toBe('Alice') // restored
  })
})

// ---------------------------------------------------------------------------
// cancelNavigation
// ---------------------------------------------------------------------------

describe('cancelNavigation', () => {
  it('clears pendingNavigationAction', async () => {
    await executeAndAnalyze()
    await useQueryStore.getState().setEditMode(activeQuerySurfaceRef('tab-1'), 'testdb.users')
    useQueryStore.getState().startEditingRow(activeQuerySurfaceRef('tab-1'), 0)
    useQueryStore.getState().updateCellValue(activeQuerySurfaceRef('tab-1'), 1, 'Changed')

    const action = vi.fn()
    useQueryStore.getState().requestNavigationAction(activeQuerySurfaceRef('tab-1'), action)
    useQueryStore.getState().cancelNavigation(activeQuerySurfaceRef('tab-1'))

    expect(
      getActiveResult(useQueryStore.getState().getTabState('tab-1')).view.prompts.pendingNavigation
    ).toBeNull()
    expect(action).not.toHaveBeenCalled()
  })
})
