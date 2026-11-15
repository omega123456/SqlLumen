/**
 * Tests for shared cell editors (NullableCellEditor, EnumCellEditor).
 *
 * Verifies that both editors call updateCellValue AND syncCellValue
 * via their explicit callback props when the user edits a value,
 * and that they follow the shared grid editor protocol
 * (onRowChange, onClose).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NullableCellEditor, EnumCellEditor } from '../../../components/shared/grid-cell-editors'
import type { CellEditorBaseProps } from '../../../components/shared/grid-cell-editors'
import { FkLookupProvider } from '../../../components/shared/fk-lookup-context'

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

    const input = document.querySelector('input[data-variant="gridCell"]') as HTMLInputElement
    expect(input).toBeTruthy()

    fireEvent.change(input, { target: { value: 'Updated' } })

    expect(props.updateCellValue).toHaveBeenCalledWith('tab-1', 'col_1', 'Updated')
  })

  it('calls syncCellValue on the props when the user types', () => {
    const props = makeEditorProps()
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('input[data-variant="gridCell"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Updated' } })

    // syncCellValue must be called alongside updateCellValue so the
    // backing row data stays in sync (matching useCellEditor behaviour).
    expect(props.syncCellValue).toHaveBeenCalledWith('tab-1', {
      rowData: expect.any(Object),
      column: 'col_1',
      value: 'Updated',
    })
  })

  it('calls onRowChange when the user types (shared grid preview)', () => {
    const props = makeEditorProps()
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('input[data-variant="gridCell"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Updated' } })

    expect(props.onRowChange).toHaveBeenCalledWith({ col_0: 1, col_1: 'Updated' })
  })

  it('calls syncCellValue when toggling NULL on', () => {
    const props = makeEditorProps()
    render(<NullableCellEditor {...props} />)

    const nullBtn = document.querySelector('[data-null-toggle]') as HTMLButtonElement
    fireEvent.click(nullBtn)

    expect(props.syncCellValue).toHaveBeenCalledWith('tab-1', {
      rowData: expect.any(Object),
      column: 'col_1',
      value: null,
    })
  })

  it('starts in NULL mode and typing leaves NULL mode automatically', async () => {
    const user = userEvent.setup()
    const props = makeEditorProps({ row: { col_0: 1, col_1: null } })
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('input[data-variant="gridCell"]') as HTMLInputElement
    const nullBtn = document.querySelector('[data-null-toggle]') as HTMLButtonElement

    expect(nullBtn).toHaveAttribute('data-active')
    expect(input).toHaveValue('')

    await user.type(input, 'Updated')

    expect(nullBtn).not.toHaveAttribute('data-active')
    expect(input).toHaveValue('Updated')
    expect(props.onRowChange).toHaveBeenLastCalledWith({ col_0: 1, col_1: 'Updated' })
  })

  it('clears entered text when re-enabling NULL', async () => {
    const user = userEvent.setup()
    const props = makeEditorProps({ row: { col_0: 1, col_1: null } })
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('input[data-variant="gridCell"]') as HTMLInputElement
    const nullBtn = document.querySelector('[data-null-toggle]') as HTMLButtonElement

    await user.type(input, 'Updated')
    await user.click(nullBtn)

    expect(nullBtn).toHaveAttribute('data-active')
    expect(input).toHaveValue('')
    expect(props.onRowChange).toHaveBeenLastCalledWith({ col_0: 1, col_1: null })
  })

  it('calls onRowChange with null when toggling NULL on', () => {
    const props = makeEditorProps()
    render(<NullableCellEditor {...props} />)

    const nullBtn = document.querySelector('[data-null-toggle]') as HTMLButtonElement
    fireEvent.click(nullBtn)

    expect(props.onRowChange).toHaveBeenCalledWith({ col_0: 1, col_1: null })
  })

  it('calls syncCellValue when toggling NULL off', () => {
    const props = makeEditorProps({ row: { col_0: 1, col_1: null } })
    render(<NullableCellEditor {...props} />)

    const nullBtn = document.querySelector('[data-null-toggle]') as HTMLButtonElement
    fireEvent.click(nullBtn)

    // When toggling NULL off, the editor restores with empty string
    expect(props.syncCellValue).toHaveBeenCalledWith('tab-1', {
      rowData: expect.any(Object),
      column: 'col_1',
      value: '',
    })
  })

  it('calls syncCellValue when Escape restores original value', () => {
    const props = makeEditorProps()
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('input[data-variant="gridCell"]') as HTMLInputElement
    // Type something first
    fireEvent.change(input, { target: { value: 'Changed' } })
    vi.clearAllMocks()

    // Press Escape to restore
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(props.syncCellValue).toHaveBeenCalledWith('tab-1', {
      rowData: expect.any(Object),
      column: 'col_1',
      value: 'original',
    })
  })

  it('uses the typing-activation restore value when Escape cancels a seeded edit', () => {
    const props = makeEditorProps({
      row: { col_0: 1, col_1: 'N' },
      initialInputValue: 'N',
      cancelRestoreValue: 'Original Value',
      selectAllOnFocus: false,
    })
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('input[data-variant="gridCell"]') as HTMLInputElement
    expect(input).toHaveValue('N')
    fireEvent.change(input, { target: { value: 'New Value' } })
    vi.clearAllMocks()

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(props.syncCellValue).toHaveBeenCalledWith('tab-1', {
      rowData: expect.any(Object),
      column: 'col_1',
      value: 'Original Value',
    })
    expect(props.onRowChange).toHaveBeenCalledWith({ col_0: 1, col_1: 'Original Value' }, false)
    expect(props.onClose).toHaveBeenCalledWith(false, false)

    fireEvent.blur(input)

    expect(props.onClose).not.toHaveBeenCalledWith(true, false)
  })

  it('calls onClose(false, false) on Escape', () => {
    const props = makeEditorProps()
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('input[data-variant="gridCell"]') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(props.onClose).toHaveBeenCalledWith(false, false)
  })

  it('calls onRowChange with commit=true on Tab', () => {
    const props = makeEditorProps()
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('input[data-variant="gridCell"]') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Tab' })

    expect(props.onRowChange).toHaveBeenCalledWith({ col_0: 1, col_1: 'original' }, true)
  })

  it('calls onRowChange with commit=true on Enter', () => {
    const props = makeEditorProps()
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('input[data-variant="gridCell"]') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(props.onRowChange).toHaveBeenCalledWith({ col_0: 1, col_1: 'original' }, true)
  })

  it('does NOT call updateCellValue or syncCellValue when tabId is falsy (guard behaviour)', () => {
    // Verifies the safety guard: if tabId is ever empty, store calls are skipped.
    const props = makeEditorProps({ tabId: '' })
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('input[data-variant="gridCell"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Changed' } })

    // With empty tabId, the cell editor guards prevent the call
    expect(props.updateCellValue).not.toHaveBeenCalled()
    expect(props.syncCellValue).not.toHaveBeenCalled()
  })

  it('calls onClose(true, false) on blur to outside', () => {
    const props = makeEditorProps()
    render(<NullableCellEditor {...props} />)

    const input = document.querySelector('input[data-variant="gridCell"]') as HTMLInputElement
    fireEvent.blur(input, { relatedTarget: null })

    expect(props.onClose).toHaveBeenCalledWith(true, false)
  })

  it('shows the FK trigger next to the text input', () => {
    const props = makeEditorProps({
      foreignKey: {
        columnName: 'col_1',
        referencedDatabase: 'app',
        referencedTable: 'people',
        referencedColumn: 'id',
        constraintName: 'fk_people',
      },
    })
    render(
      <FkLookupProvider onFkLookup={vi.fn()}>
        <NullableCellEditor {...props} />
      </FkLookupProvider>
    )

    expect(document.querySelector('input[data-variant="gridCell"]')).toBeTruthy()
    expect(screen.getByTestId('fk-lookup-trigger')).toBeInTheDocument()
  })

  // Regression: the editor overlay must be closed before the FK lookup dialog is
  // requested, otherwise the floating glide overlay (higher z-index portal) renders
  // above the modal.
  it('closes the overlay before requesting FK lookup via the trigger button', async () => {
    const user = userEvent.setup()
    const onFkLookup = vi.fn()
    const props = makeEditorProps({
      foreignKey: {
        columnName: 'col_1',
        referencedDatabase: 'app',
        referencedTable: 'people',
        referencedColumn: 'id',
        constraintName: 'fk_people',
      },
    })
    render(
      <FkLookupProvider onFkLookup={onFkLookup}>
        <NullableCellEditor {...props} />
      </FkLookupProvider>
    )

    await user.click(screen.getByTestId('fk-lookup-trigger'))

    expect(props.onClose).toHaveBeenCalledWith(true, false)
    expect(onFkLookup).toHaveBeenCalledWith(expect.objectContaining({ source: 'editor-trigger' }))
    const closeOrder = (props.onClose as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    const lookupOrder = onFkLookup.mock.invocationCallOrder[0]
    expect(closeOrder).toBeLessThan(lookupOrder)
  })

  it('closes the overlay before requesting FK lookup via F4', () => {
    const onFkLookup = vi.fn()
    const props = makeEditorProps({
      foreignKey: {
        columnName: 'col_1',
        referencedDatabase: 'app',
        referencedTable: 'people',
        referencedColumn: 'id',
        constraintName: 'fk_people',
      },
    })
    render(
      <FkLookupProvider onFkLookup={onFkLookup}>
        <NullableCellEditor {...props} />
      </FkLookupProvider>
    )

    const input = document.querySelector('input[data-variant="gridCell"]') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'F4' })

    expect(props.onClose).toHaveBeenCalledWith(true, false)
    expect(onFkLookup).toHaveBeenCalledWith(expect.objectContaining({ source: 'keyboard' }))
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

  it('shows the FK trigger next to the enum trigger', () => {
    const props = makeEnumProps({
      foreignKey: {
        columnName: 'col_2',
        referencedDatabase: 'app',
        referencedTable: 'status_lookup',
        referencedColumn: 'id',
        constraintName: 'fk_status',
      },
    })
    render(
      <FkLookupProvider onFkLookup={vi.fn()}>
        <EnumCellEditor {...props} />
      </FkLookupProvider>
    )

    expect(document.querySelector('[data-sqllumen-grid-editor="enum-inline"]')).toBeTruthy()
    expect(screen.getByTestId('fk-lookup-trigger')).toBeInTheDocument()
  })

  // Regression: closing the overlay before opening the dialog keeps the floating
  // glide overlay (higher z-index portal) from rendering above the modal.
  it('closes the overlay before requesting FK lookup via F4', () => {
    const onFkLookup = vi.fn()
    const props = makeEnumProps({
      foreignKey: {
        columnName: 'col_2',
        referencedDatabase: 'app',
        referencedTable: 'status_lookup',
        referencedColumn: 'id',
        constraintName: 'fk_status',
      },
    })
    render(
      <FkLookupProvider onFkLookup={onFkLookup}>
        <EnumCellEditor {...props} />
      </FkLookupProvider>
    )

    const trigger = document.querySelector('[data-sqllumen-grid-editor]') as HTMLButtonElement
    fireEvent.keyDown(trigger, { key: 'F4' })

    expect(props.onClose).toHaveBeenCalledWith(true, false)
    expect(onFkLookup).toHaveBeenCalledWith(expect.objectContaining({ source: 'keyboard' }))
  })

  it('uses the dropdown as the full overlay editor when requested', () => {
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} fullOverlay />)

    expect(document.querySelector('[data-sqllumen-grid-editor="enum-overlay"]')).toBeTruthy()
    expect(screen.queryByTestId('fk-lookup-trigger')).not.toBeInTheDocument()
    expect(document.querySelector('[data-null-toggle]')).toBeFalsy()
  })

  it('opens the full-overlay enum dropdown from the trigger', async () => {
    const user = userEvent.setup()
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} fullOverlay />)

    const trigger = document.querySelector('[data-sqllumen-grid-editor]') as HTMLButtonElement
    await user.click(trigger)

    expect(screen.getByRole('listbox', { name: 'col_2' })).toBeInTheDocument()
  })

  it('keeps the full-overlay enum editor open while focus moves into the dropdown listbox', async () => {
    const user = userEvent.setup()
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} fullOverlay />)

    const trigger = document.querySelector('[data-sqllumen-grid-editor]') as HTMLButtonElement
    await user.click(trigger)

    const listbox = screen.getByRole('listbox', { name: 'col_2' })
    expect(listbox).toHaveFocus()
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('calls syncCellValue when selecting a new enum value', async () => {
    const user = userEvent.setup()
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} />)

    const combo = document.querySelector('[data-sqllumen-grid-editor]') as HTMLButtonElement
    expect(combo).toBeTruthy()

    await user.click(combo)
    await user.click(screen.getByRole('option', { name: 'inactive' }))

    expect(props.syncCellValue).toHaveBeenCalledWith('tab-1', {
      rowData: expect.any(Object),
      column: 'col_2',
      value: 'inactive',
    })
  })

  it('calls onRowChange when selecting a new enum value', async () => {
    const user = userEvent.setup()
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} />)

    const combo = document.querySelector('[data-sqllumen-grid-editor]') as HTMLButtonElement
    await user.click(combo)
    await user.click(screen.getByRole('option', { name: 'inactive' }))

    expect(props.onRowChange).toHaveBeenCalledWith({ col_0: 1, col_2: 'inactive' })
  })

  it('calls syncCellValue when toggling NULL on', () => {
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} />)

    const nullBtn = document.querySelector('[data-null-toggle]') as HTMLButtonElement
    fireEvent.click(nullBtn)

    expect(props.syncCellValue).toHaveBeenCalledWith('tab-1', {
      rowData: expect.any(Object),
      column: 'col_2',
      value: null,
    })
  })

  it('calls onRowChange with null when toggling NULL on', () => {
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} />)

    const nullBtn = document.querySelector('[data-null-toggle]') as HTMLButtonElement
    fireEvent.click(nullBtn)

    expect(props.onRowChange).toHaveBeenCalledWith({ col_0: 1, col_2: null })
  })

  it('calls onClose(false, false) on Escape', () => {
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} />)

    const combo = document.querySelector('[data-sqllumen-grid-editor]') as HTMLButtonElement
    fireEvent.keyDown(combo, { key: 'Escape' })

    expect(props.onClose).toHaveBeenCalledWith(false, false)
  })

  it('calls onRowChange with commit=true on Tab', () => {
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} />)

    const combo = document.querySelector('[data-sqllumen-grid-editor]') as HTMLButtonElement
    fireEvent.keyDown(combo, { key: 'Tab' })

    expect(props.onRowChange).toHaveBeenCalledWith({ col_0: 1, col_2: 'active' }, true)
  })

  it('keeps the enum dropdown open without closing the editor on trigger click', async () => {
    const user = userEvent.setup()
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} />)

    const combo = document.querySelector('[data-sqllumen-grid-editor]') as HTMLButtonElement
    await user.click(combo)

    expect(screen.getByRole('listbox', { name: 'col_2' })).toBeInTheDocument()
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('commits and closes after choosing an enum option with the keyboard', async () => {
    const user = userEvent.setup()
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} />)

    const combo = document.querySelector('[data-sqllumen-grid-editor]') as HTMLButtonElement
    await user.click(combo)
    await user.keyboard('i')
    await user.keyboard('{Enter}')

    expect(props.onRowChange).toHaveBeenCalledWith({ col_0: 1, col_2: 'inactive' })
    expect(props.onClose).toHaveBeenCalledWith(true, true)
  })

  it('commits and closes after clicking an enum option', async () => {
    const user = userEvent.setup()
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} />)

    const combo = document.querySelector('[data-sqllumen-grid-editor]') as HTMLButtonElement
    await user.click(combo)
    await user.click(screen.getByRole('option', { name: 'inactive' }))

    expect(props.onRowChange).toHaveBeenCalledWith({ col_0: 1, col_2: 'inactive' })
    expect(props.onClose).toHaveBeenCalledWith(true, true)
  })

  it('does not close on trigger blur while focus moves into the portaled listbox', async () => {
    const user = userEvent.setup()
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} />)

    const combo = document.querySelector('[data-sqllumen-grid-editor]') as HTMLButtonElement
    await user.click(combo)

    const listbox = screen.getByRole('listbox', { name: 'col_2' })
    fireEvent.blur(combo, { relatedTarget: listbox })

    await Promise.resolve()

    expect(props.onClose).not.toHaveBeenCalledWith(true, false)
  })

  it('does not close on trigger blur while focus moves into a portaled option', async () => {
    const user = userEvent.setup()
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} />)

    const combo = document.querySelector('[data-sqllumen-grid-editor]') as HTMLButtonElement
    await user.click(combo)

    const option = screen.getByRole('option', { name: 'inactive' })
    fireEvent.blur(combo, { relatedTarget: option })

    await Promise.resolve()

    expect(props.onClose).not.toHaveBeenCalledWith(true, false)
  })

  it('Escape cancels the enum edit even when the dropdown is open', async () => {
    const user = userEvent.setup()
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} />)

    const combo = document.querySelector('[data-sqllumen-grid-editor]') as HTMLButtonElement
    await user.click(combo)
    await user.keyboard('{Escape}')

    expect(props.onClose).toHaveBeenCalledWith(false, false)
  })

  it('typeahead works with uppercase letters', async () => {
    const user = userEvent.setup()
    const props = makeEnumProps()
    render(<EnumCellEditor {...props} />)

    const combo = document.querySelector('[data-sqllumen-grid-editor]') as HTMLButtonElement
    await user.click(combo)
    await user.keyboard('I')
    await user.keyboard('{Enter}')

    expect(props.onRowChange).toHaveBeenCalledWith({ col_0: 1, col_2: 'inactive' })
    expect(props.onClose).toHaveBeenCalledWith(true, true)
  })
})
