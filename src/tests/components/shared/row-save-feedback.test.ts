import { beforeEach, describe, expect, it } from 'vitest'
import { reportInvalidTemporalValue } from '../../../components/shared/row-save-feedback'
import { useToastStore } from '../../../stores/toast-store'
import type { RowEditState, TableDataColumnMeta } from '../../../types/schema'

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

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
})

describe('reportInvalidTemporalValue', () => {
  it('returns null for valid values', () => {
    expect(reportInvalidTemporalValue(buildEditState('2025-02-03'), COLUMNS)).toBeNull()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
