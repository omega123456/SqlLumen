/**
 * Tests for shared AG Grid cell editors (NullableCellEditor, EnumCellEditor).
 *
 * Verifies that both editors call updateCellValue AND syncCellValue
 * on the AG Grid context when the user edits a value, matching the
 * behaviour of DateTimeCellEditor / useCellEditor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { NullableCellEditor, EnumCellEditor } from '../../../components/shared/grid-cell-editors'
import type { GridEditContext } from '../../../components/shared/grid-cell-editors'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface EditorHandle {
  getValue: () => unknown
}

function makeContext(overrides: Partial<GridEditContext> = {}): GridEditContext {
  return {
    tabId: 'tab-1',
    updateCellValue: vi.fn(),
    syncCellValue: vi.fn(),
    ...overrides,
  }
}

function makeEditorParams(
  context: GridEditContext,
  overrides: Record<string, unknown> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return {
    value: 'original',
    colDef: { field: 'col_1' },
    context,
    api: { stopEditing: vi.fn() },
    node: { data: { col_0: 1, col_1: 'original' } },
    data: { col_0: 1, col_1: 'original' },
    column: { getColId: () => 'col_1' },
    isNullable: true,
    columnMeta: {
      name: 'name',
      dataType: 'VARCHAR',
      isNullable: true,
      isPrimaryKey: false,
      isUniqueKey: false,
      hasDefault: false,
      columnDefault: null,
      isBinary: false,
      isBooleanAlias: false,
      isAutoIncrement: false,
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// NullableCellEditor
// ---------------------------------------------------------------------------

describe('NullableCellEditor — store syncing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls updateCellValue on the context when the user types', () => {
    const ctx = makeContext()
    const ref = createRef<EditorHandle>()
    const params = makeEditorParams(ctx)

    render(<NullableCellEditor ref={ref} {...params} />)

    const input = document.querySelector('.td-cell-editor-input') as HTMLInputElement
    expect(input).toBeTruthy()

    fireEvent.change(input, { target: { value: 'Updated' } })

    expect(ctx.updateCellValue).toHaveBeenCalledWith('tab-1', 'col_1', 'Updated')
  })

  it('calls syncCellValue on the context when the user types', () => {
    const ctx = makeContext()
    const ref = createRef<EditorHandle>()
    const params = makeEditorParams(ctx)

    render(<NullableCellEditor ref={ref} {...params} />)

    const input = document.querySelector('.td-cell-editor-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Updated' } })

    // syncCellValue must be called alongside updateCellValue so the
    // backing row data stays in sync (matching useCellEditor behaviour).
    expect(ctx.syncCellValue).toHaveBeenCalledWith(
      'tab-1',
      expect.any(Object), // rowData
      'col_1',
      'Updated'
    )
  })

  it('calls syncCellValue when toggling NULL on', () => {
    const ctx = makeContext()
    const ref = createRef<EditorHandle>()
    const params = makeEditorParams(ctx)

    render(<NullableCellEditor ref={ref} {...params} />)

    const nullBtn = document.querySelector('.td-null-toggle') as HTMLButtonElement
    fireEvent.click(nullBtn)

    expect(ctx.syncCellValue).toHaveBeenCalledWith('tab-1', expect.any(Object), 'col_1', null)
  })

  it('calls syncCellValue when toggling NULL off', () => {
    const ctx = makeContext()
    const ref = createRef<EditorHandle>()
    const params = makeEditorParams(ctx, { value: null })

    render(<NullableCellEditor ref={ref} {...params} />)

    const nullBtn = document.querySelector('.td-null-toggle') as HTMLButtonElement
    fireEvent.click(nullBtn)

    // When toggling NULL off, the editor restores with empty string
    expect(ctx.syncCellValue).toHaveBeenCalledWith('tab-1', expect.any(Object), 'col_1', '')
  })

  it('calls syncCellValue when Escape restores original value', () => {
    const ctx = makeContext()
    const ref = createRef<EditorHandle>()
    const params = makeEditorParams(ctx)

    render(<NullableCellEditor ref={ref} {...params} />)

    const input = document.querySelector('.td-cell-editor-input') as HTMLInputElement
    // Type something first
    fireEvent.change(input, { target: { value: 'Changed' } })
    vi.clearAllMocks()

    // Press Escape to restore
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(ctx.syncCellValue).toHaveBeenCalledWith('tab-1', expect.any(Object), 'col_1', 'original')
  })

  it('does NOT call updateCellValue or syncCellValue when tabId is falsy (guard behaviour)', () => {
    // Verifies the safety guard: if tabId is ever empty, store calls are skipped.
    // The ResultGridView fix ensures this never happens in practice.
    const ctx = makeContext({ tabId: '' })
    const ref = createRef<EditorHandle>()
    const params = makeEditorParams(ctx)

    render(<NullableCellEditor ref={ref} {...params} />)

    const input = document.querySelector('.td-cell-editor-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Changed' } })

    // With empty tabId, the cell editor guards prevent the call
    expect(ctx.updateCellValue).not.toHaveBeenCalled()
    expect(ctx.syncCellValue).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// EnumCellEditor
// ---------------------------------------------------------------------------

describe('EnumCellEditor — store syncing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeEnumParams(
    context: GridEditContext,
    overrides: Record<string, unknown> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any {
    return {
      value: 'active',
      colDef: { field: 'col_2' },
      context,
      api: { stopEditing: vi.fn() },
      node: { data: { col_0: 1, col_2: 'active' } },
      data: { col_0: 1, col_2: 'active' },
      column: { getColId: () => 'col_2' },
      isNullable: true,
      columnMeta: {
        name: 'status',
        dataType: 'ENUM',
        enumValues: ['active', 'inactive', 'pending'],
        isNullable: true,
        isPrimaryKey: false,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isBooleanAlias: false,
        isAutoIncrement: false,
      },
      ...overrides,
    }
  }

  it('calls syncCellValue when selecting a new enum value', () => {
    const ctx = makeContext()
    const ref = createRef<EditorHandle>()
    const params = makeEnumParams(ctx)

    render(<EnumCellEditor ref={ref} {...params} />)

    const select = document.querySelector('.td-cell-editor-select') as HTMLSelectElement
    expect(select).toBeTruthy()

    fireEvent.change(select, { target: { value: 'inactive' } })

    expect(ctx.syncCellValue).toHaveBeenCalledWith('tab-1', expect.any(Object), 'col_2', 'inactive')
  })

  it('calls syncCellValue when toggling NULL on', () => {
    const ctx = makeContext()
    const ref = createRef<EditorHandle>()
    const params = makeEnumParams(ctx)

    render(<EnumCellEditor ref={ref} {...params} />)

    const nullBtn = document.querySelector('.td-null-toggle') as HTMLButtonElement
    fireEvent.click(nullBtn)

    expect(ctx.syncCellValue).toHaveBeenCalledWith('tab-1', expect.any(Object), 'col_2', null)
  })
})
