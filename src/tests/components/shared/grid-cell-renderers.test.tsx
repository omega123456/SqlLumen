/**
 * Tests for react-data-grid cell renderers.
 *
 * Verifies NULL display (muted styling), BLOB display, and regular value display.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { TableDataCellRenderer } from '../../../components/shared/grid-cell-renderers'
import { useSettingsStore } from '../../../stores/settings-store'

// ---------------------------------------------------------------------------
// Helpers — minimal mock of RenderCellProps
// ---------------------------------------------------------------------------

function makeCellProps(key: string, value: unknown) {
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
    },
    row: { [key]: value } as Record<string, unknown>,
    rowIdx: 0,
    isCellEditable: false,
    tabIndex: -1,
    onRowChange: () => {},
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset settings store to defaults (no loaded settings)
  useSettingsStore.setState({ settings: {}, pendingChanges: {}, isDirty: false })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TableDataCellRenderer', () => {
  it('displays NULL with muted styling for null values', () => {
    const { container } = render(<TableDataCellRenderer {...makeCellProps('name', null)} />)

    const span = container.querySelector('.td-null-value')
    expect(span).not.toBeNull()
    expect(span?.textContent).toBe('NULL')
  })

  it('displays NULL with muted styling for undefined values', () => {
    // Row doesn't have the key at all — value is undefined
    const props = {
      ...makeCellProps('missing_col', undefined),
      row: {} as Record<string, unknown>,
    }

    const { container } = render(<TableDataCellRenderer {...props} />)

    const span = container.querySelector('.td-null-value')
    expect(span).not.toBeNull()
    expect(span?.textContent).toBe('NULL')
  })

  it('displays BLOB values with distinctive styling', () => {
    const { container } = render(
      <TableDataCellRenderer {...makeCellProps('data', '[BLOB 1024 bytes]')} />
    )

    const span = container.querySelector('.td-blob-value')
    expect(span).not.toBeNull()
    expect(span?.textContent).toBe('[BLOB 1024 bytes]')
  })

  it('displays regular string values as plain text', () => {
    const { container } = render(<TableDataCellRenderer {...makeCellProps('name', 'Alice')} />)

    const span = container.querySelector('span')
    expect(span?.textContent).toBe('Alice')
    expect(container.querySelector('.td-null-value')).toBeNull()
    expect(container.querySelector('.td-blob-value')).toBeNull()
  })

  it('displays numeric values as stringified text', () => {
    const { container } = render(<TableDataCellRenderer {...makeCellProps('count', 42)} />)

    const span = container.querySelector('span')
    expect(span?.textContent).toBe('42')
    expect(container.querySelector('.td-null-value')).toBeNull()
    expect(container.querySelector('.td-blob-value')).toBeNull()
  })

  it('does not treat non-BLOB strings starting with [ as BLOB', () => {
    const { container } = render(
      <TableDataCellRenderer {...makeCellProps('note', '[array value]')} />
    )

    expect(container.querySelector('.td-blob-value')).toBeNull()
    expect(container.querySelector('span')?.textContent).toBe('[array value]')
  })

  it('displays custom null text from settings store', () => {
    useSettingsStore.setState({
      settings: { 'results.nullDisplay': '(empty)' },
    })

    const { container } = render(<TableDataCellRenderer {...makeCellProps('name', null)} />)

    const span = container.querySelector('.td-null-value')
    expect(span).not.toBeNull()
    expect(span?.textContent).toBe('(empty)')
  })
})
