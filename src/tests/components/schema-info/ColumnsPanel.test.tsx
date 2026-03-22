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
  it('wraps table in ui-elevated-surface', () => {
    const columns = [makeColumn()]

    const { container } = render(<ColumnsPanel columns={columns} />)

    expect(container.querySelectorAll('.ui-elevated-surface')).toHaveLength(1)
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

  it('shows PRI badge with correct styles', () => {
    const columns = [makeColumn({ name: 'id', columnKey: 'PRI' })]

    render(<ColumnsPanel columns={columns} />)

    const badge = screen.getByText('PRI')
    expect(badge).toBeInTheDocument()
    // Check it has a class (CSS module hashing means we can't check exact class name)
    expect(badge.className).toContain('keyBadge')
    expect(badge.className).toContain('keyPri')
  })

  it('shows MUL badge with correct styles', () => {
    const columns = [makeColumn({ name: 'user_id', columnKey: 'MUL' })]

    render(<ColumnsPanel columns={columns} />)

    const badge = screen.getByText('MUL')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('keyBadge')
    expect(badge.className).toContain('keyMul')
  })

  it('shows UNI badge with correct styles', () => {
    const columns = [makeColumn({ name: 'email', columnKey: 'UNI' })]

    render(<ColumnsPanel columns={columns} />)

    const badge = screen.getByText('UNI')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('keyBadge')
    expect(badge.className).toContain('keyUni')
  })

  it('shows null indicator correctly', () => {
    const columns = [
      makeColumn({ name: 'id', nullable: false }),
      makeColumn({ name: 'bio', nullable: true, ordinalPosition: 2 }),
    ]

    render(<ColumnsPanel columns={columns} />)

    expect(screen.getByText('NO')).toBeInTheDocument()
    expect(screen.getByText('YES')).toBeInTheDocument()
  })

  it('shows default value when present', () => {
    const columns = [makeColumn({ name: 'status', defaultValue: 'active' })]

    render(<ColumnsPanel columns={columns} />)

    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('shows NULL when default value is null', () => {
    const columns = [makeColumn({ name: 'id', defaultValue: null })]

    render(<ColumnsPanel columns={columns} />)

    expect(screen.getByText('NULL')).toBeInTheDocument()
  })
})
