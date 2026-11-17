import { describe, expect, it } from 'vitest'
import {
  applySignedness,
  cellsInDirection,
  clampSelection,
  defaultValueForMode,
  dragShiftFor,
  editStartKey,
  getSelectionAfterDelete,
  getSelectionAfterReorder,
  isModifiedCell,
  isNumericType,
  isTypeWithoutLength,
} from '../../../components/table-designer/column-editor-model'
import { createDefaultTabState } from '../../../stores/table-designer-store/designer-schema'
import type { TableDesignerTabState } from '../../../stores/table-designer-store'
import type { TableDesignerColumnDef } from '../../../types/schema'

function makeColumn(overrides: Partial<TableDesignerColumnDef> = {}): TableDesignerColumnDef {
  return {
    name: 'id',
    type: 'INT',
    typeModifier: '',
    length: '11',
    nullable: false,
    isPrimaryKey: true,
    isAutoIncrement: true,
    defaultValue: { tag: 'NO_DEFAULT' },
    comment: '',
    originalName: 'id',
    ...overrides,
  }
}

function alterTabWith(originalColumns: TableDesignerColumnDef[]): TableDesignerTabState {
  const tab = createDefaultTabState({
    mode: 'alter',
    connectionId: 'conn',
    databaseName: 'db',
    objectName: 'users',
  })
  return {
    ...tab,
    originalSchema: { ...tab.currentSchema, columns: originalColumns },
  }
}

describe('column type predicates', () => {
  it('detects types without a length and numeric types', () => {
    expect(isTypeWithoutLength('text')).toBe(true)
    expect(isTypeWithoutLength('VARCHAR')).toBe(false)
    expect(isNumericType(' bigint ')).toBe(true)
    expect(isNumericType('VARCHAR')).toBe(false)
  })
})

describe('signedness', () => {
  it('adds UNSIGNED in front of the preserved modifier tokens', () => {
    expect(applySignedness('ZEROFILL', 'UNSIGNED')).toBe('UNSIGNED ZEROFILL')
    expect(applySignedness(null, 'UNSIGNED')).toBe('UNSIGNED')
  })
})

describe('isModifiedCell', () => {
  it('never marks cells in create mode', () => {
    const tab = createDefaultTabState({
      mode: 'create',
      connectionId: 'conn',
      databaseName: 'db',
      objectName: '',
    })
    expect(isModifiedCell(tab, makeColumn(), 'name')).toBe(false)
  })

  it('marks every cell of a column added in alter mode', () => {
    const tab = alterTabWith([makeColumn()])
    const addedColumn = makeColumn({ name: 'email', originalName: '' })
    expect(isModifiedCell(tab, addedColumn, 'comment')).toBe(true)
  })
})

describe('default values', () => {
  it('builds a default value for each mode', () => {
    expect(defaultValueForMode('NO_DEFAULT', 'x')).toEqual({ tag: 'NO_DEFAULT' })
    expect(defaultValueForMode('NULL_DEFAULT', 'x')).toEqual({ tag: 'NULL_DEFAULT' })
    expect(defaultValueForMode('LITERAL', 'x')).toEqual({ tag: 'LITERAL', value: 'x' })
    expect(defaultValueForMode('unknown', 'now()')).toEqual({ tag: 'EXPRESSION', value: 'now()' })
  })
})

describe('row drag and selection', () => {
  it('shifts the rows passed by a drag', () => {
    const forwardDrag = { from: 0, to: 2, rowHeight: 30 }
    expect(dragShiftFor(null, 1)).toBe(0)
    expect(dragShiftFor(forwardDrag, 1)).toBe(-1)
    expect(dragShiftFor(forwardDrag, 3)).toBe(0)
    expect(dragShiftFor({ from: 2, to: 0, rowHeight: 30 }, 1)).toBe(1)
  })

  it('follows the selection through a reorder', () => {
    expect(getSelectionAfterReorder(null, 0, 2)).toBeNull()
    expect(getSelectionAfterReorder(0, 0, 2)).toBe(2)
    expect(getSelectionAfterReorder(1, 0, 2)).toBe(0)
    expect(getSelectionAfterReorder(3, 0, 2)).toBe(3)
  })

  it('moves the selection after a delete', () => {
    expect(getSelectionAfterDelete(null, 0)).toBeNull()
    expect(getSelectionAfterDelete(2, 2)).toBe(1)
    expect(getSelectionAfterDelete(0, 0)).toBeNull()
    expect(getSelectionAfterDelete(3, 1)).toBe(2)
    expect(getSelectionAfterDelete(0, 1)).toBe(0)
  })

  it('clamps the selection to the last column', () => {
    expect(clampSelection(null, 3)).toBeNull()
    expect(clampSelection(1, 0)).toBeNull()
    expect(clampSelection(5, 3)).toBe(2)
  })
})

describe('cell traversal', () => {
  it('keys edit baselines by row and cell', () => {
    expect(editStartKey({ rowIndex: 2, cellKey: 'comment' })).toBe('2:comment')
  })

  it('walks forward across rows', () => {
    const cells = cellsInDirection({
      from: { rowIndex: 0, cellKey: 'default' },
      direction: 1,
      columnCount: 2,
    })
    expect(cells.slice(0, 2)).toEqual([
      { rowIndex: 0, cellKey: 'comment' },
      { rowIndex: 1, cellKey: 'name' },
    ])
    expect(cells).toHaveLength(7)
  })
})
