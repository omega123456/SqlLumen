import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetadataCard } from '../../../components/schema-info/MetadataCard'
import type { TableMetadata } from '../../../types/schema'

function makeMetadata(overrides: Partial<TableMetadata> = {}): TableMetadata {
  return {
    engine: 'InnoDB',
    collation: 'utf8mb4_general_ci',
    autoIncrement: 1001,
    createTime: '2023-01-15T00:00:00',
    tableRows: 1000,
    dataLength: 16384,
    indexLength: 8192,
    ...overrides,
  }
}

describe('MetadataCard', () => {
  it('shows engine value', () => {
    render(<MetadataCard metadata={makeMetadata()} />)

    expect(screen.getByTestId('metadata-card')).toBeInTheDocument()
    expect(screen.getByText('InnoDB')).toBeInTheDocument()
  })

  it('shows collation value', () => {
    render(<MetadataCard metadata={makeMetadata()} />)

    expect(screen.getByText('utf8mb4_general_ci')).toBeInTheDocument()
  })

  it('shows auto increment', () => {
    render(<MetadataCard metadata={makeMetadata({ autoIncrement: 1001 })} />)

    expect(screen.getByText(Number(1001).toLocaleString())).toBeInTheDocument()
  })

  it('shows dash when auto increment is null', () => {
    render(<MetadataCard metadata={makeMetadata({ autoIncrement: null })} />)

    // The auto increment value should be a dash
    const items = screen.getAllByText('—')
    expect(items.length).toBeGreaterThan(0)
  })

  it('shows created date', () => {
    render(<MetadataCard metadata={makeMetadata({ createTime: '2023-01-15T00:00:00' })} />)

    // The date should be formatted by toLocaleDateString
    // In test env it may vary, but the element should exist
    const card = screen.getByTestId('metadata-card')
    expect(card.textContent).toContain('2023')
  })

  it('shows dash when createTime is null', () => {
    render(<MetadataCard metadata={makeMetadata({ createTime: null })} />)

    const items = screen.getAllByText('—')
    expect(items.length).toBeGreaterThan(0)
  })
})
