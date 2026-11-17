import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FilterToolbarButton } from '../../../components/shared/FilterToolbarButton'

describe('FilterToolbarButton', () => {
  it('renders filter button with data-testid="btn-filter"', () => {
    render(
      <FilterToolbarButton
        isActive={false}
        activeCount={0}
        onFilterClick={() => {}}
        onClearClick={() => {}}
      />
    )
    expect(screen.getByTestId('btn-filter')).toBeInTheDocument()
    expect(screen.getByText('Filter')).toBeInTheDocument()
  })

  it('does not show badge or clear button when inactive', () => {
    render(
      <FilterToolbarButton
        isActive={false}
        activeCount={0}
        onFilterClick={() => {}}
        onClearClick={() => {}}
      />
    )
    expect(screen.queryByTestId('filter-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('btn-clear-filter')).not.toBeInTheDocument()
  })

  it('shows badge with count and clear button when active', () => {
    render(
      <FilterToolbarButton
        isActive={true}
        activeCount={3}
        onFilterClick={() => {}}
        onClearClick={() => {}}
      />
    )
    const badge = screen.getByTestId('filter-badge')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('3')

    const clearBtn = screen.getByTestId('btn-clear-filter')
    expect(clearBtn).toBeInTheDocument()
    expect(clearBtn).toHaveAttribute('aria-label', 'Clear filters')
  })

  it('disables both buttons when isDisabled is true', () => {
    render(
      <FilterToolbarButton
        isActive={true}
        activeCount={2}
        onFilterClick={() => {}}
        onClearClick={() => {}}
        isDisabled={true}
      />
    )
    expect(screen.getByTestId('btn-filter')).toBeDisabled()
    expect(screen.getByTestId('btn-clear-filter')).toBeDisabled()
  })
})
