import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ColumnsPanel } from '../../../components/schema-info/ColumnsPanel'
import type { ColumnInfo } from '../../../types/schema'

function makeColumn(overrides: Partial<ColumnInfo> = {}): ColumnInfo {
  return {
    name: 'id',
    dataType: 'bigint',
    nullable: false,
    columnKey: '',
    defaultValue: null,
    extra: '',
    ordinalPosition: 1,
    ...overrides,
  }
}

describe('ColumnsPanel', () => {
  it('wraps table in an elevated surface', () => {
    const columns = [makeColumn()]

    const { container } = render(<ColumnsPanel columns={columns} />)

    expect(container.querySelectorAll('[data-variant="bordered"]')).toHaveLength(1)
  })

  it('renders correct column count', () => {
    const columns = [
      makeColumn({ name: 'id', ordinalPosition: 1 }),
      makeColumn({ name: 'name', dataType: 'varchar', ordinalPosition: 2 }),
      makeColumn({ name: 'email', dataType: 'varchar', ordinalPosition: 3 }),
    ]

    render(<ColumnsPanel columns={columns} />)

    expect(screen.getByTestId('columns-panel')).toBeInTheDocument()
    const rows = screen.getAllByRole('row')
    // 1 header row + 3 data rows
    expect(rows).toHaveLength(4)
  })

  it('shows the PRI, MUL and UNI key badges', () => {
    const columns = [
      makeColumn({ name: 'id', columnKey: 'PRI' }),
      makeColumn({ name: 'user_id', columnKey: 'MUL', ordinalPosition: 2 }),
      makeColumn({ name: 'email', columnKey: 'UNI', ordinalPosition: 3 }),
    ]

    render(<ColumnsPanel columns={columns} />)

    expect(screen.getByText('PRI')).toBeInTheDocument()
    expect(screen.getByText('MUL')).toBeInTheDocument()
    expect(screen.getByText('UNI')).toBeInTheDocument()
  })

  it('shows null indicator correctly', () => {
    const columns = [
      makeColumn({ name: 'id', nullable: false }),
      makeColumn({ name: 'bio', nullable: true, ordinalPosition: 2 }),
    ]

    render(<ColumnsPanel columns={columns} />)

    expect(screen.getByText('No')).toBeInTheDocument()
    expect(screen.getByText('Yes')).toBeInTheDocument()
  })

  it('shows default value when present', () => {
    const columns = [makeColumn({ name: 'status', defaultValue: 'active' })]

    render(<ColumnsPanel columns={columns} />)

    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('shows an unknown key with the neutral key pill', () => {
    const columns = [makeColumn({ name: 'x', columnKey: 'OTHER' })]

    render(<ColumnsPanel columns={columns} />)

    const badge = screen.getByText('OTHER')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('data-tone', 'other')
  })

  it('shows NULL when default value is null', () => {
    const columns = [makeColumn({ name: 'id', defaultValue: null })]

    render(<ColumnsPanel columns={columns} />)

    expect(screen.getByText('NULL')).toBeInTheDocument()
  })
})
