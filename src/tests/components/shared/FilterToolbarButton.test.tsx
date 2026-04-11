import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

  it('calls onFilterClick when filter button is clicked', () => {
    const onFilterClick = vi.fn()
    render(
      <FilterToolbarButton
        isActive={false}
        activeCount={0}
        onFilterClick={onFilterClick}
        onClearClick={() => {}}
      />
    )
    fireEvent.click(screen.getByTestId('btn-filter'))
    expect(onFilterClick).toHaveBeenCalledOnce()
  })

  it('calls onClearClick when clear button is clicked', () => {
    const onClearClick = vi.fn()
    render(
      <FilterToolbarButton
        isActive={true}
        activeCount={1}
        onFilterClick={() => {}}
        onClearClick={onClearClick}
      />
    )
    fireEvent.click(screen.getByTestId('btn-clear-filter'))
    expect(onClearClick).toHaveBeenCalledOnce()
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

  it('buttons are enabled when isDisabled is false', () => {
    render(
      <FilterToolbarButton
        isActive={true}
        activeCount={1}
        onFilterClick={() => {}}
        onClearClick={() => {}}
        isDisabled={false}
      />
    )
    expect(screen.getByTestId('btn-filter')).not.toBeDisabled()
    expect(screen.getByTestId('btn-clear-filter')).not.toBeDisabled()
  })
})
