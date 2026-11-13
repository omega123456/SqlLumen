import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from '@testing-library/react'
import {
  reportInvalidTemporalValue,
  saveCurrentRowWithFeedback,
} from '../../../components/table-data/row-save-feedback'
import { useTableDataStore } from '../../../stores/table-data-store'
import { useToastStore } from '../../../stores/toast-store'
import type { RowEditState, TableDataColumnMeta } from '../../../types/schema'
import { expectToast, ipc } from '../../ipc-mock'
import { makeTableDataTabState } from '../../helpers/table-data-test-utils'

const TAB_ID = 'tab-1'

const COLUMNS: TableDataColumnMeta[] = [
  {
    name: 'id',
    dataType: 'bigint',
    isNullable: false,
    isPrimaryKey: true,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isBooleanAlias: false,
    isAutoIncrement: true,
  },
  {
    name: 'created_at',
    dataType: 'date',
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isBooleanAlias: false,
    isAutoIncrement: false,
  },
]

function buildEditState(createdAt: string): RowEditState {
  return {
    rowKey: { id: 1 },
    originalValues: { id: 1, created_at: '2025-01-01' },
    currentValues: { id: 1, created_at: createdAt },
    modifiedColumns: new Set(['created_at']),
    isNewRow: false,
  }
}

function seedTab(editState: RowEditState): void {
  act(() => {
    useTableDataStore.setState({
      tabs: {
        [TAB_ID]: makeTableDataTabState({
          columns: COLUMNS,
          rows: [[1, '2025-01-01']],
          primaryKey: { keyColumns: ['id'], hasAutoIncrement: true, isUniqueKeyFallback: false },
          editState: editState,
        }),
      },
    })
  })
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
})

afterEach(() => {
  act(() => {
    useTableDataStore.setState({ tabs: {} })
  })
})

describe('reportInvalidTemporalValue', () => {
  it('shows an error toast and returns the invalid column', () => {
    const validationError = reportInvalidTemporalValue(buildEditState('not-a-date'), COLUMNS)

    expect(validationError?.columnName).toBe('created_at')
    expectToast('error', 'Invalid date value')
  })

  it('returns null for valid values', () => {
    expect(reportInvalidTemporalValue(buildEditState('2025-02-03'), COLUMNS)).toBeNull()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})

describe('saveCurrentRowWithFeedback', () => {
  it('does not save when a temporal value is invalid', async () => {
    const editState = buildEditState('not-a-date')
    seedTab(editState)

    const validationError = await act(() =>
      saveCurrentRowWithFeedback({ tabId: TAB_ID, editState: editState, columns: COLUMNS })
    )

    expect(validationError?.columnName).toBe('created_at')
    expect(ipc.payloads('update_table_row')).toHaveLength(0)
  })

  it('saves the row and shows a success toast', async () => {
    ipc.override('update_table_row', () => undefined)
    const editState = buildEditState('2025-02-03')
    seedTab(editState)

    const validationError = await act(() =>
      saveCurrentRowWithFeedback({ tabId: TAB_ID, editState: editState, columns: COLUMNS })
    )

    expect(validationError).toBeNull()
    expect(ipc.payloads('update_table_row')).toHaveLength(1)
    expectToast('success', 'Row saved')
  })

  it('shows the save error when the save fails', async () => {
    ipc.override('update_table_row', () => {
      throw new Error('Duplicate entry')
    })
    const editState = buildEditState('2025-02-03')
    seedTab(editState)

    await act(() =>
      saveCurrentRowWithFeedback({ tabId: TAB_ID, editState: editState, columns: COLUMNS })
    )

    expectToast('error', 'Save failed')
  })
})
