import { describe, expect, it } from 'vitest'
import {
  applySignedness,
  canAutoIncrement,
  cellsInDirection,
  clampSelection,
  defaultValueForMode,
  defaultValueText,
  dragShiftFor,
  dropIndexFor,
  editStartKey,
  getSelectionAfterDelete,
  getSelectionAfterReorder,
  isLastEditableCell,
  isModifiedCell,
  isNumericType,
  isTextDefaultMode,
  isTypeWithoutLength,
  mustClearAutoIncrementForType,
  sameCellsBelow,
  selectionMoves,
  toSignedness,
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

  it('allows auto increment only on numeric primary keys', () => {
    expect(canAutoIncrement(makeColumn())).toBe(true)
    expect(canAutoIncrement(makeColumn({ isPrimaryKey: false }))).toBe(false)
    expect(canAutoIncrement(makeColumn({ type: 'VARCHAR' }))).toBe(false)
  })

  it('clears auto increment when the new type is not numeric', () => {
    expect(mustClearAutoIncrementForType(makeColumn(), 'VARCHAR')).toBe(true)
    expect(mustClearAutoIncrementForType(makeColumn(), 'BIGINT')).toBe(false)
    expect(mustClearAutoIncrementForType(makeColumn({ isAutoIncrement: false }), 'TEXT')).toBe(
      false
    )
  })
})

describe('signedness', () => {
  it('adds UNSIGNED in front of the preserved modifier tokens', () => {
    expect(applySignedness('ZEROFILL', 'UNSIGNED')).toBe('UNSIGNED ZEROFILL')
    expect(applySignedness(null, 'UNSIGNED')).toBe('UNSIGNED')
  })

  it('strips UNSIGNED when switching to signed', () => {
    expect(applySignedness('unsigned  ZEROFILL', 'SIGNED')).toBe('ZEROFILL')
    expect(applySignedness(undefined, 'SIGNED')).toBe('')
  })

  it('maps dropdown values to signedness', () => {
    expect(toSignedness('UNSIGNED')).toBe('UNSIGNED')
    expect(toSignedness('anything')).toBe('SIGNED')
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

  it('marks a changed field and leaves unchanged fields clean', () => {
    const tab = alterTabWith([makeColumn()])
    const editedColumn = makeColumn({ comment: 'primary id' })
    expect(isModifiedCell(tab, editedColumn, 'comment')).toBe(true)
    expect(isModifiedCell(tab, editedColumn, 'name')).toBe(false)
  })

  it('compares type modifiers after normalisation', () => {
    const tab = alterTabWith([makeColumn({ typeModifier: 'UNSIGNED' })])
    expect(isModifiedCell(tab, makeColumn({ typeModifier: 'unsigned' }), 'typeModifier')).toBe(
      false
    )
    expect(isModifiedCell(tab, makeColumn({ typeModifier: '' }), 'typeModifier')).toBe(true)
  })

  it('treats a column without any name as unmatched', () => {
    const tab = alterTabWith([makeColumn()])
    const unnamedColumn = makeColumn({ name: '', originalName: '' })
    expect(isModifiedCell(tab, unnamedColumn, 'name')).toBe(true)
  })
})

describe('default values', () => {
  it('builds a default value for each mode', () => {
    expect(defaultValueForMode('NO_DEFAULT', 'x')).toEqual({ tag: 'NO_DEFAULT' })
    expect(defaultValueForMode('NULL_DEFAULT', 'x')).toEqual({ tag: 'NULL_DEFAULT' })
    expect(defaultValueForMode('LITERAL', 'x')).toEqual({ tag: 'LITERAL', value: 'x' })
    expect(defaultValueForMode('unknown', 'now()')).toEqual({ tag: 'EXPRESSION', value: 'now()' })
  })

  it('recognises the text modes and reads their text', () => {
    expect(isTextDefaultMode('LITERAL')).toBe(true)
    expect(isTextDefaultMode('EXPRESSION')).toBe(true)
    expect(isTextDefaultMode('NULL_DEFAULT')).toBe(false)
    expect(defaultValueText({ tag: 'LITERAL', value: 'abc' })).toBe('abc')
    expect(defaultValueText({ tag: 'NO_DEFAULT' })).toBe('')
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

  it('clamps the drop index to the column range', () => {
    expect(dropIndexFor({ from: 1, offset: 62, rowHeight: 30, columnCount: 5 })).toBe(3)
    expect(dropIndexFor({ from: 1, offset: -200, rowHeight: 30, columnCount: 5 })).toBe(0)
    expect(dropIndexFor({ from: 1, offset: 900, rowHeight: 30, columnCount: 5 })).toBe(4)
  })

  it('clamps the selection to the last column', () => {
    expect(clampSelection(null, 3)).toBeNull()
    expect(clampSelection(1, 0)).toBeNull()
    expect(clampSelection(5, 3)).toBe(2)
  })

  it('reports which toolbar moves are available', () => {
    expect(selectionMoves(null, 3)).toEqual({
      canMoveUp: false,
      canMoveDown: false,
      canDelete: false,
    })
    expect(selectionMoves(0, 3)).toEqual({ canMoveUp: false, canMoveDown: true, canDelete: true })
    expect(selectionMoves(2, 3)).toEqual({ canMoveUp: true, canMoveDown: false, canDelete: true })
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

  it('walks backward to the first cell', () => {
    const cells = cellsInDirection({
      from: { rowIndex: 0, cellKey: 'length' },
      direction: -1,
      columnCount: 2,
    })
    expect(cells).toEqual([
      { rowIndex: 0, cellKey: 'type' },
      { rowIndex: 0, cellKey: 'name' },
    ])
  })

  it('lists the same cell in the following rows', () => {
    expect(sameCellsBelow({ rowIndex: 0, cellKey: 'type' }, 3)).toEqual([
      { rowIndex: 1, cellKey: 'type' },
      { rowIndex: 2, cellKey: 'type' },
    ])
  })

  it('detects the last editable cell', () => {
    expect(isLastEditableCell({ rowIndex: 1, cellKey: 'comment' }, 2)).toBe(true)
    expect(isLastEditableCell({ rowIndex: 0, cellKey: 'comment' }, 2)).toBe(false)
    expect(isLastEditableCell({ rowIndex: 1, cellKey: 'name' }, 2)).toBe(false)
  })
})
