/**
 * Tests for shared cell editors (NullableCellEditor, EnumCellEditor).
 *
 * Verifies that both editors call updateCellValue AND syncCellValue
 * via their explicit callback props when the user edits a value,
 * and that they follow the react-data-grid editor protocol
 * (onRowChange, onClose).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NullableCellEditor, EnumCellEditor } from '../../../components/shared/grid-cell-editors'
import type { CellEditorBaseProps } from '../../../components/shared/grid-cell-editors'
import { getCellEditorForColumn } from '../../../components/shared/grid-column-editor-utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEditorProps(overrides: Partial<CellEditorBaseProps> = {}): CellEditorBaseProps {
  return {
    row: { col_0: 1, col_1: 'original' },
    column: { key: 'col_1' },
    onRowChange: vi.fn(),
    onClose: vi.fn(),
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
    tabId: 'tab-1',
    updateCellValue: vi.fn(),
    syncCellValue: vi.fn(),
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

  it('calls updateCellValue on the props when the user types', () => {
    const props = makeEditorProps()
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('.td-cell-editor-input') as HTMLInputElement
    expect(input).toBeTruthy()

    fireEvent.change(input, { target: { value: 'Updated' } })

    expect(props.updateCellValue).toHaveBeenCalledWith('tab-1', 'col_1', 'Updated')
  })

  it('calls syncCellValue on the props when the user types', () => {
    const props = makeEditorProps()
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('.td-cell-editor-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Updated' } })

    // syncCellValue must be called alongside updateCellValue so the
    // backing row data stays in sync (matching useCellEditor behaviour).
    expect(props.syncCellValue).toHaveBeenCalledWith(
      'tab-1',
      expect.any(Object), // row
      'col_1',
      'Updated'
    )
  })

  it('calls onRowChange when the user types (react-data-grid preview)', () => {
    const props = makeEditorProps()
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('.td-cell-editor-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Updated' } })

    expect(props.onRowChange).toHaveBeenCalledWith({ col_0: 1, col_1: 'Updated' })
  })

  it('calls syncCellValue when toggling NULL on', () => {
    const props = makeEditorProps()
    render(<NullableCellEditor {...props} />)

    const nullBtn = document.querySelector('.td-null-toggle') as HTMLButtonElement
    fireEvent.click(nullBtn)

    expect(props.syncCellValue).toHaveBeenCalledWith('tab-1', expect.any(Object), 'col_1', null)
  })

  it('calls onRowChange with null when toggling NULL on', () => {
    const props = makeEditorProps()
    render(<NullableCellEditor {...props} />)

    const nullBtn = document.querySelector('.td-null-toggle') as HTMLButtonElement
    fireEvent.click(nullBtn)

    expect(props.onRowChange).toHaveBeenCalledWith({ col_0: 1, col_1: null })
  })

  it('calls syncCellValue when toggling NULL off', () => {
    const props = makeEditorProps({ row: { col_0: 1, col_1: null } })
    render(<NullableCellEditor {...props} />)

    const nullBtn = document.querySelector('.td-null-toggle') as HTMLButtonElement
    fireEvent.click(nullBtn)

    // When toggling NULL off, the editor restores with empty string
    expect(props.syncCellValue).toHaveBeenCalledWith('tab-1', expect.any(Object), 'col_1', '')
  })

  it('calls syncCellValue when Escape restores original value', () => {
    const props = makeEditorProps()
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('.td-cell-editor-input') as HTMLInputElement
    // Type something first
    fireEvent.change(input, { target: { value: 'Changed' } })
    vi.clearAllMocks()

    // Press Escape to restore
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(props.syncCellValue).toHaveBeenCalledWith(
      'tab-1',
      expect.any(Object),
      'col_1',
      'original'
    )
  })

  it('calls onClose(false, false) on Escape', () => {
    const props = makeEditorProps()
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('.td-cell-editor-input') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(props.onClose).toHaveBeenCalledWith(false, false)
  })

  it('calls onRowChange with commit=true on Tab', () => {
    const props = makeEditorProps()
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('.td-cell-editor-input') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Tab' })

    expect(props.onRowChange).toHaveBeenCalledWith({ col_0: 1, col_1: 'original' }, true)
  })

  it('calls onRowChange with commit=true on Enter', () => {
    const props = makeEditorProps()
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('.td-cell-editor-input') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(props.onRowChange).toHaveBeenCalledWith({ col_0: 1, col_1: 'original' }, true)
  })

  it('does NOT call updateCellValue or syncCellValue when tabId is falsy (guard behaviour)', () => {
    // Verifies the safety guard: if tabId is ever empty, store calls are skipped.
    const props = makeEditorProps({ tabId: '' })
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('.td-cell-editor-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Changed' } })

    // With empty tabId, the cell editor guards prevent the call
    expect(props.updateCellValue).not.toHaveBeenCalled()
    expect(props.syncCellValue).not.toHaveBeenCalled()
  })

  it('calls onClose(true, false) on blur to outside', () => {
    const props = makeEditorProps()
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('.td-cell-editor-input') as HTMLInputElement
    fireEvent.blur(input, { relatedTarget: null })

    expect(props.onClose).toHaveBeenCalledWith(true, false)
  })
})

// ---------------------------------------------------------------------------
// EnumCellEditor
// ---------------------------------------------------------------------------

describe('EnumCellEditor — store syncing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeEnumProps(overrides: Partial<CellEditorBaseProps> = {}): CellEditorBaseProps {
    return {
      row: { col_0: 1, col_2: 'active' },
      column: { key: 'col_2' },
      onRowChange: vi.fn(),
      onClose: vi.fn(),
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
      tabId: 'tab-1',
      updateCellValue: vi.fn(),
      syncCellValue: vi.fn(),
      ...overrides,
    }
  }

  it('calls syncCellValue when selecting a new enum value', async () => {
    const user = userEvent.setup()
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} />)

    const combo = document.querySelector('.td-cell-editor-select') as HTMLButtonElement
    expect(combo).toBeTruthy()

    await user.click(combo)
    await user.click(screen.getByRole('option', { name: 'inactive' }))

    expect(props.syncCellValue).toHaveBeenCalledWith(
      'tab-1',
      expect.any(Object),
      'col_2',
      'inactive'
    )
  })

  it('calls onRowChange when selecting a new enum value', async () => {
    const user = userEvent.setup()
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} />)

    const combo = document.querySelector('.td-cell-editor-select') as HTMLButtonElement
    await user.click(combo)
    await user.click(screen.getByRole('option', { name: 'inactive' }))

    expect(props.onRowChange).toHaveBeenCalledWith({ col_0: 1, col_2: 'inactive' })
  })

  it('calls syncCellValue when toggling NULL on', () => {
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} />)

    const nullBtn = document.querySelector('.td-null-toggle') as HTMLButtonElement
    fireEvent.click(nullBtn)

    expect(props.syncCellValue).toHaveBeenCalledWith('tab-1', expect.any(Object), 'col_2', null)
  })

  it('calls onRowChange with null when toggling NULL on', () => {
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} />)

    const nullBtn = document.querySelector('.td-null-toggle') as HTMLButtonElement
    fireEvent.click(nullBtn)

    expect(props.onRowChange).toHaveBeenCalledWith({ col_0: 1, col_2: null })
  })

  it('calls onClose(false, false) on Escape', () => {
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} />)

    const combo = document.querySelector('.td-cell-editor-select') as HTMLButtonElement
    fireEvent.keyDown(combo, { key: 'Escape' })

    expect(props.onClose).toHaveBeenCalledWith(false, false)
  })

  it('calls onRowChange with commit=true on Tab', () => {
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} />)

    const combo = document.querySelector('.td-cell-editor-select') as HTMLButtonElement
    fireEvent.keyDown(combo, { key: 'Tab' })

    expect(props.onRowChange).toHaveBeenCalledWith({ col_0: 1, col_2: 'active' }, true)
  })
})

describe('getCellEditorForColumn', () => {
  const callbacks = {
    tabId: 'tab-1',
    updateCellValue: vi.fn(),
    syncCellValue: vi.fn(),
  }

  it('disables closeOnExternalRowChange for nullable editors', () => {
    const config = getCellEditorForColumn(
      {
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
      callbacks
    )

    expect(config.editorOptions).toEqual({ closeOnExternalRowChange: false })
  })

  it('disables closeOnExternalRowChange and outside-click commit for temporal editors', () => {
    const config = getCellEditorForColumn(
      {
        name: 'created_at',
        dataType: 'DATETIME',
        isNullable: true,
        isPrimaryKey: false,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isBooleanAlias: false,
        isAutoIncrement: false,
      },
      callbacks
    )

    expect(config.editorOptions).toEqual({
      closeOnExternalRowChange: false,
      commitOnOutsideClick: false,
    })
  })

  it('disables closeOnExternalRowChange for enum editors', () => {
    const config = getCellEditorForColumn(
      {
        name: 'status',
        dataType: 'ENUM',
        enumValues: ['active', 'inactive'],
        isNullable: true,
        isPrimaryKey: false,
        isUniqueKey: false,
        hasDefault: false,
        columnDefault: null,
        isBinary: false,
        isBooleanAlias: false,
        isAutoIncrement: false,
      },
      callbacks
    )

    expect(config.editorOptions).toEqual({ closeOnExternalRowChange: false })
  })
})
