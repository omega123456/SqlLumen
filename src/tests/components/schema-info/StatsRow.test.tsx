import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatsRow } from '../../../components/schema-info/StatsRow'
import type { TableMetadata } from '../../../types/schema'

function makeMetadata(overrides: Partial<TableMetadata> = {}): TableMetadata {
  return {
    engine: 'InnoDB',
    collation: 'utf8mb4_general_ci',
    autoIncrement: 101,
    createTime: '2023-01-01',
    tableRows: 45000,
    dataLength: 1048576,
    indexLength: 524288,
    ...overrides,
  }
}

describe('StatsRow', () => {
  it('renders three elevated stat cards', () => {
    const { container } = render(<StatsRow metadata={makeMetadata()} />)

    expect(container.querySelectorAll('.ui-elevated-surface')).toHaveLength(3)
  })

  it('shows formatted row count', () => {
    render(<StatsRow metadata={makeMetadata({ tableRows: 45000 })} />)

    expect(screen.getByTestId('stats-row')).toBeInTheDocument()
    expect(screen.getByText(Number(45000).toLocaleString())).toBeInTheDocument()
  })

  it('shows engine', () => {
    render(<StatsRow metadata={makeMetadata({ engine: 'InnoDB' })} />)

    expect(screen.getByText('InnoDB')).toBeInTheDocument()
  })

  it('shows formatted index size in KB', () => {
    // 8192 bytes = 8.0 KB
    render(<StatsRow metadata={makeMetadata({ indexLength: 8192 })} />)

    expect(screen.getByText('8.0 KB')).toBeInTheDocument()
  })

  it('shows formatted index size in MB', () => {
    // 1048576 bytes = 1.0 MB
    render(<StatsRow metadata={makeMetadata({ indexLength: 1048576 })} />)

    expect(screen.getByText('1.0 MB')).toBeInTheDocument()
  })

  it('shows formatted index size in GB', () => {
    // 1073741824 bytes = 1.0 GB
    render(<StatsRow metadata={makeMetadata({ indexLength: 1073741824 })} />)

    expect(screen.getByText('1.0 GB')).toBeInTheDocument()
  })

  it('shows formatted index size in B for small values', () => {
    render(<StatsRow metadata={makeMetadata({ indexLength: 512 })} />)

    expect(screen.getByText('512 B')).toBeInTheDocument()
  })

  it('renders all three stat cards', () => {
    render(<StatsRow metadata={makeMetadata()} />)

    expect(screen.getByText('Total Rows')).toBeInTheDocument()
    expect(screen.getByText('Storage Engine')).toBeInTheDocument()
    expect(screen.getByText('Index Size')).toBeInTheDocument()
  })

  it('renders column count card next to row count when columnCount is set', () => {
    const { container } = render(
      <StatsRow metadata={makeMetadata({ tableRows: 100 })} columnCount={12} />
    )

    expect(screen.getByTestId('stats-columns-card')).toBeInTheDocument()
    expect(screen.getByText('Column count')).toBeInTheDocument()
    expect(screen.getByText(Number(12).toLocaleString())).toBeInTheDocument()
    expect(container.querySelectorAll('.ui-elevated-surface')).toHaveLength(4)
  })
})
