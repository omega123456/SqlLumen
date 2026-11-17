import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HistoryFilterPanel } from '../../../components/history/HistoryFilterPanel'

describe('HistoryFilterPanel', () => {
  it('renders all 4 filter buttons', () => {
    render(<HistoryFilterPanel value="all" onChange={vi.fn()} />)

    expect(screen.getByTestId('filter-all')).toBeInTheDocument()
    expect(screen.getByTestId('filter-24h')).toBeInTheDocument()
    expect(screen.getByTestId('filter-7d')).toBeInTheDocument()
    expect(screen.getByTestId('filter-30d')).toBeInTheDocument()
  })

  it('displays correct labels', () => {
    render(<HistoryFilterPanel value="all" onChange={vi.fn()} />)

    expect(screen.getByText('All history')).toBeInTheDocument()
    expect(screen.getByText('Past 24 hours')).toBeInTheDocument()
    expect(screen.getByText('Last 7 days')).toBeInTheDocument()
    expect(screen.getByText('Last 30 days')).toBeInTheDocument()
  })
})
