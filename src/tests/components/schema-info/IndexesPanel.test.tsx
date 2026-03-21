import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IndexesPanel } from '../../../components/schema-info/IndexesPanel'
import type { IndexInfo } from '../../../types/schema'

function makeIndex(overrides: Partial<IndexInfo> = {}): IndexInfo {
  return {
    name: 'PRIMARY',
    indexType: 'BTREE',
    cardinality: 1000,
    columns: ['id'],
    isVisible: true,
    isUnique: true,
    ...overrides,
  }
}

describe('IndexesPanel', () => {
  it('renders all indexes', () => {
    const indexes = [
      makeIndex({ name: 'PRIMARY', columns: ['id'] }),
      makeIndex({ name: 'idx_email', isUnique: false, columns: ['email'] }),
    ]

    render(<IndexesPanel indexes={indexes} />)

    expect(screen.getByTestId('indexes-panel')).toBeInTheDocument()
    const rows = screen.getAllByRole('row')
    // 1 header + 2 data rows
    expect(rows).toHaveLength(3)
  })

  it('shows PRIMARY badge', () => {
    const indexes = [makeIndex({ name: 'PRIMARY' })]

    render(<IndexesPanel indexes={indexes} />)

    // The checkmark badge for PRIMARY
    const badge = screen.getByLabelText('Primary key')
    expect(badge).toBeInTheDocument()
    expect(screen.getByText('PRIMARY')).toBeInTheDocument()
  })

  it('shows UNI badge for unique non-primary indexes', () => {
    const indexes = [makeIndex({ name: 'idx_email', isUnique: true })]

    render(<IndexesPanel indexes={indexes} />)

    expect(screen.getByText('UNI')).toBeInTheDocument()
  })

  it('formats cardinality with thousands separator', () => {
    const indexes = [makeIndex({ cardinality: 45000 })]

    render(<IndexesPanel indexes={indexes} />)

    // toLocaleString() for 45000 should produce "45,000" in en-US
    const cell = screen.getByText(/45/)
    expect(cell).toBeInTheDocument()
    // Verify it's formatted (not just "45000")
    expect(cell.textContent).toBe(Number(45000).toLocaleString())
  })

  it('shows column pills', () => {
    const indexes = [makeIndex({ columns: ['user_id', 'created_at'] })]

    render(<IndexesPanel indexes={indexes} />)

    expect(screen.getByText('user_id')).toBeInTheDocument()
    expect(screen.getByText('created_at')).toBeInTheDocument()
    // Check they have pill styling
    const pill = screen.getByText('user_id')
    expect(pill.className).toContain('columnPill')
  })

  it('shows dash for null cardinality', () => {
    const indexes = [makeIndex({ cardinality: null })]

    render(<IndexesPanel indexes={indexes} />)

    // Find the dash character
    const cells = screen.getAllByText('—')
    expect(cells.length).toBeGreaterThan(0)
  })
})
