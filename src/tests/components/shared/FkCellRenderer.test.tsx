/**
 * Tests for FkCellRenderer — FK cell renderer with trigger button.
 *
 * Verifies:
 * - Cell value display (normal, NULL, BLOB)
 * - Trigger button presence with correct attributes
 * - FK lookup callback invocation with correct arguments
 * - Mouse down event propagation is stopped
 */

import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { FkCellRenderer } from '../../../components/shared/FkCellRenderer'
import { FkLookupContext } from '../../../components/shared/fk-lookup-context'
import type { FkLookupContextValue } from '../../../components/shared/fk-lookup-context'
import type { ForeignKeyColumnInfo } from '../../../types/schema'

// ---------------------------------------------------------------------------
// Helpers — minimal mock of RenderCellProps with foreignKey on column
// ---------------------------------------------------------------------------

const sampleFk: ForeignKeyColumnInfo = {
  columnName: 'user_id',
  referencedTable: 'users',
  referencedColumn: 'id',
  constraintName: 'fk_orders_user_id',
}

function makeFkCellProps(key: string, value: unknown, foreignKey?: ForeignKeyColumnInfo) {
  return {
    column: {
      key,
      name: key,
      idx: 0,
      level: 0,
      width: 100,
      minWidth: 50,
      maxWidth: undefined,
      resizable: true,
      sortable: true,
      draggable: false,
      frozen: false,
      parent: undefined,
      renderCell: () => null,
      renderHeaderCell: () => null,
      ...(foreignKey && { foreignKey }),
    },
    row: { [key]: value, name: 'Test User' } as Record<string, unknown>,
    rowIdx: 0,
    isCellEditable: false,
    tabIndex: -1,
    onRowChange: () => {},
  }
}

function renderWithContext(
  ui: React.ReactElement,
  contextValue: FkLookupContextValue | null = null
) {
  if (contextValue) {
    return render(<FkLookupContext.Provider value={contextValue}>{ui}</FkLookupContext.Provider>)
  }
  return render(ui)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FkCellRenderer', () => {
  it('renders the cell value correctly', () => {
    const { container } = renderWithContext(
      <FkCellRenderer {...makeFkCellProps('user_id', 42, sampleFk)} />
    )

    const span = container.querySelector('span')
    expect(span?.textContent).toBe('42')
  })

  it('renders NULL values with muted styling', () => {
    const { container } = renderWithContext(
      <FkCellRenderer {...makeFkCellProps('user_id', null, sampleFk)} />
    )

    const span = container.querySelector('.td-null-value')
    expect(span).not.toBeNull()
    expect(span?.textContent).toBe('NULL')
  })

  it('renders undefined values with NULL indicator', () => {
    const props = {
      ...makeFkCellProps('missing_col', undefined, sampleFk),
      row: {} as Record<string, unknown>,
    }

    const { container } = renderWithContext(<FkCellRenderer {...props} />)

    const span = container.querySelector('.td-null-value')
    expect(span).not.toBeNull()
    expect(span?.textContent).toBe('NULL')
  })

  it('renders BLOB values with distinctive styling', () => {
    const { container } = renderWithContext(
      <FkCellRenderer {...makeFkCellProps('user_id', '[BLOB 512 bytes]', sampleFk)} />
    )

    const span = container.querySelector('.td-blob-value')
    expect(span).not.toBeNull()
    expect(span?.textContent).toBe('[BLOB 512 bytes]')
  })

  it('renders the trigger button with data-testid="fk-lookup-trigger"', () => {
    const { getByTestId } = renderWithContext(
      <FkCellRenderer {...makeFkCellProps('user_id', 42, sampleFk)} />
    )

    const button = getByTestId('fk-lookup-trigger')
    expect(button).toBeTruthy()
    expect(button.tagName).toBe('BUTTON')
  })

  it('trigger button is present in the DOM with data-fk-trigger attribute', () => {
    const { getByTestId } = renderWithContext(
      <FkCellRenderer {...makeFkCellProps('user_id', 42, sampleFk)} />
    )

    const button = getByTestId('fk-lookup-trigger')
    expect(button.hasAttribute('data-fk-trigger')).toBe(true)
  })

  it('trigger button has correct aria-label', () => {
    const { getByTestId } = renderWithContext(
      <FkCellRenderer {...makeFkCellProps('user_id', 42, sampleFk)} />
    )

    const button = getByTestId('fk-lookup-trigger')
    expect(button.getAttribute('aria-label')).toBe('Look up foreign key value (F4)')
  })

  it('clicking the trigger button calls onFkLookup with correct arguments', () => {
    const onFkLookup = vi.fn()
    const contextValue: FkLookupContextValue = { onFkLookup }

    const { getByTestId } = renderWithContext(
      <FkCellRenderer {...makeFkCellProps('user_id', 42, sampleFk)} />,
      contextValue
    )

    const button = getByTestId('fk-lookup-trigger')
    fireEvent.click(button)

    expect(onFkLookup).toHaveBeenCalledOnce()
    expect(onFkLookup).toHaveBeenCalledWith({
      columnKey: 'user_id',
      currentValue: 42,
      foreignKey: sampleFk,
      rowData: { user_id: 42, name: 'Test User' },
    })
  })

  it('mouse down on the trigger button stops propagation', () => {
    const parentMouseDown = vi.fn()
    const onFkLookup = vi.fn()
    const contextValue: FkLookupContextValue = { onFkLookup }

    const { getByTestId } = render(
      <FkLookupContext.Provider value={contextValue}>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div onMouseDown={parentMouseDown}>
          <FkCellRenderer {...makeFkCellProps('user_id', 42, sampleFk)} />
        </div>
      </FkLookupContext.Provider>
    )

    const button = getByTestId('fk-lookup-trigger')
    fireEvent.mouseDown(button)

    // Parent's mouseDown should NOT be called because stopPropagation was called
    expect(parentMouseDown).not.toHaveBeenCalled()
  })

  it('does not call onFkLookup when no context is provided', () => {
    const { getByTestId } = renderWithContext(
      <FkCellRenderer {...makeFkCellProps('user_id', 42, sampleFk)} />
    )

    // Should not throw when clicking without a context provider
    const button = getByTestId('fk-lookup-trigger')
    expect(() => fireEvent.click(button)).not.toThrow()
  })

  it('does not render trigger button when no foreignKey on column', () => {
    const onFkLookup = vi.fn()
    const contextValue: FkLookupContextValue = { onFkLookup }

    const { queryByTestId } = renderWithContext(
      <FkCellRenderer {...makeFkCellProps('user_id', 42)} />,
      contextValue
    )

    expect(queryByTestId('fk-lookup-trigger')).toBeNull()
    expect(onFkLookup).not.toHaveBeenCalled()
  })
})
