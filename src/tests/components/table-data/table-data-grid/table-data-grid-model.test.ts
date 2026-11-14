import { describe, expect, it } from 'vitest'
import {
  buildColumnLookup,
  checkedRowKeyOf,
  computeTableColumnWidth,
  currentValuesFromRow,
  rowIdentityKey,
  selectedCellPositionOf,
  toSharedTableEditState,
} from '../../../../components/table-data/table-data-grid/table-data-grid-model'
import { DEFAULT_COLUMN_WIDTH_PX } from '../../../../lib/grid-column-style'
import type { GridColumnDescriptor } from '../../../../types/shared-data-view'
import type { RowEditState, TableDataColumnMeta } from '../../../../types/schema'

function makeColumn(name: string): TableDataColumnMeta {
  return {
    name: name,
    dataType: 'VARCHAR',
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isBooleanAlias: false,
    isAutoIncrement: false,
  }
}

function makeDescriptor(key: string): GridColumnDescriptor {
  return {
    key: key,
    displayName: key,
    dataType: 'VARCHAR',
    editable: true,
    isBinary: false,
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
  }
}

describe('rowIdentityKey', () => {
  it('prefers the draft temp id', () => {
    expect(rowIdentityKey({ __tempId: 'temp-1', id: 3 }, ['id'])).toBe('temp-1')
  })

  it('uses the editing row key values when present', () => {
    expect(rowIdentityKey({ __editingRowKey: { id: 7 }, id: 9 }, ['id'])).toBe('[7]')
  })

  it('uses primary key values when no editing key exists', () => {
    expect(rowIdentityKey({ id: 4, name: 'a' }, ['id'])).toBe('[4]')
  })

  it('falls back to the row index without a primary key', () => {
    expect(rowIdentityKey({ __rowIndex: 2 }, [])).toBe('2')
  })
})

describe('checkedRowKeyOf', () => {
  it('keeps only the temp id for draft rows', () => {
    expect(checkedRowKeyOf({ __tempId: 'temp-2', id: null }, ['id'])).toEqual({
      __tempId: 'temp-2',
    })
  })
})

describe('currentValuesFromRow', () => {
  it('copies one value per column', () => {
    const columns = [makeColumn('id'), makeColumn('name')]
    expect(currentValuesFromRow(columns, { id: 1, name: 'x', extra: true })).toEqual({
      id: 1,
      name: 'x',
    })
  })
})

describe('toSharedTableEditState', () => {
  it('returns null without an edit state', () => {
    expect(toSharedTableEditState(null)).toBeNull()
  })

  it('serialises the row key', () => {
    const editState = {
      rowKey: { id: 1 },
      currentValues: { name: 'b' },
      originalValues: { name: 'a' },
      modifiedColumns: new Set(['name']),
      isNewRow: false,
    } as RowEditState
    expect(toSharedTableEditState(editState)).toEqual({
      rowKey: '{"id":1}',
      currentValues: { name: 'b' },
      originalValues: { name: 'a' },
    })
  })
})

describe('selectedCellPositionOf', () => {
  const lookup = {
    rowData: [{ id: 1 }, { id: 2 }],
    descriptorColumns: [makeDescriptor('id'), makeDescriptor('name')],
    primaryKeyColumns: ['id'],
  }

  it('returns null without a selected cell', () => {
    expect(
      selectedCellPositionOf({ ...lookup, selectedRowKey: { id: 2 }, selectedCell: null })
    ).toBeNull()
  })

  it('locates the selected row and column', () => {
    expect(
      selectedCellPositionOf({
        ...lookup,
        selectedRowKey: { id: 2 },
        selectedCell: { columnKey: 'name', value: null },
      })
    ).toEqual({ rowIdx: 1, idx: 1 })
  })

  it('returns null when the row is not visible', () => {
    expect(
      selectedCellPositionOf({
        ...lookup,
        selectedRowKey: null,
        selectedCell: { columnKey: 'name', value: null },
      })
    ).toBeNull()
  })
})

describe('computeTableColumnWidth', () => {
  it('falls back to the default width for unknown columns', () => {
    const lookup = buildColumnLookup([makeColumn('id')])
    expect(computeTableColumnWidth(lookup, [[1]], makeDescriptor('missing'))).toBe(
      DEFAULT_COLUMN_WIDTH_PX
    )
  })

  it('computes a positive width for known columns', () => {
    const lookup = buildColumnLookup([makeColumn('id')])
    expect(
      computeTableColumnWidth(lookup, [['a long value']], makeDescriptor('id'))
    ).toBeGreaterThan(0)
  })
})
