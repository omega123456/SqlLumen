import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

    expect(screen.getByText('All History')).toBeInTheDocument()
    expect(screen.getByText('Past 24h')).toBeInTheDocument()
    expect(screen.getByText('Last 7 Days')).toBeInTheDocument()
    expect(screen.getByText('Last 30 Days')).toBeInTheDocument()
  })

  it('renders "TIME RANGE" heading', () => {
    render(<HistoryFilterPanel value="all" onChange={vi.fn()} />)
    expect(screen.getByText('Time Range')).toBeInTheDocument()
  })

  it('active button has aria-pressed=true', () => {
    render(<HistoryFilterPanel value="7d" onChange={vi.fn()} />)

    expect(screen.getByTestId('filter-7d')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('filter-all')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('filter-24h')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('filter-30d')).toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking a button calls onChange with correct value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<HistoryFilterPanel value="all" onChange={onChange} />)

    await user.click(screen.getByTestId('filter-24h'))
    expect(onChange).toHaveBeenCalledWith('24h')

    await user.click(screen.getByTestId('filter-7d'))
    expect(onChange).toHaveBeenCalledWith('7d')

    await user.click(screen.getByTestId('filter-30d'))
    expect(onChange).toHaveBeenCalledWith('30d')

    await user.click(screen.getByTestId('filter-all'))
    expect(onChange).toHaveBeenCalledWith('all')
  })
})
