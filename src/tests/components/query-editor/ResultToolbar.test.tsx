import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ResultToolbar } from '../../../components/query-editor/ResultToolbar'

describe('ResultToolbar', () => {
  const defaultProps = {
    status: 'success' as const,
    totalRows: 42,
    affectedRows: 0,
    columnsCount: 3,
    executionTimeMs: 150,
    error: null,
    autoLimitApplied: false,
    currentPage: 1,
    totalPages: 3,
    onPrevPage: vi.fn(),
    onNextPage: vi.fn(),
  }

  it('renders with data-testid="result-toolbar"', () => {
    render(<ResultToolbar {...defaultProps} />)
    expect(screen.getByTestId('result-toolbar')).toBeInTheDocument()
  })

  it('renders success status with correct row count', () => {
    render(<ResultToolbar {...defaultProps} />)
    expect(screen.getByText(/SUCCESS: 42 ROWS/)).toBeInTheDocument()
  })

  it('renders error status with error message', () => {
    render(
      <ResultToolbar
        {...defaultProps}
        status="error"
        error="Table 'users' doesn't exist"
        columnsCount={0}
      />
    )
    expect(screen.getByText("Table 'users' doesn't exist")).toBeInTheDocument()
  })

  it('shows "(1000 row limit applied)" when autoLimitApplied', () => {
    render(<ResultToolbar {...defaultProps} autoLimitApplied />)
    expect(screen.getByText('(1000 row limit applied)')).toBeInTheDocument()
  })

  it('does not show auto-limit text when autoLimitApplied is false', () => {
    render(<ResultToolbar {...defaultProps} autoLimitApplied={false} />)
    expect(screen.queryByText('(1000 row limit applied)')).not.toBeInTheDocument()
  })

  it('prev button is disabled on page 1', () => {
    render(<ResultToolbar {...defaultProps} currentPage={1} />)
    expect(screen.getByLabelText('Previous page')).toBeDisabled()
  })

  it('next button is disabled on last page', () => {
    render(<ResultToolbar {...defaultProps} currentPage={3} totalPages={3} />)
    expect(screen.getByLabelText('Next page')).toBeDisabled()
  })

  it('prev button is enabled when not on first page', () => {
    render(<ResultToolbar {...defaultProps} currentPage={2} />)
    expect(screen.getByLabelText('Previous page')).not.toBeDisabled()
  })

  it('next button is enabled when not on last page', () => {
    render(<ResultToolbar {...defaultProps} currentPage={1} totalPages={3} />)
    expect(screen.getByLabelText('Next page')).not.toBeDisabled()
  })

  it('calls onPrevPage when prev button clicked', () => {
    const onPrevPage = vi.fn()
    render(<ResultToolbar {...defaultProps} currentPage={2} onPrevPage={onPrevPage} />)
    fireEvent.click(screen.getByLabelText('Previous page'))
    expect(onPrevPage).toHaveBeenCalledTimes(1)
  })

  it('calls onNextPage when next button clicked', () => {
    const onNextPage = vi.fn()
    render(<ResultToolbar {...defaultProps} currentPage={1} onNextPage={onNextPage} />)
    fireEvent.click(screen.getByLabelText('Next page'))
    expect(onNextPage).toHaveBeenCalledTimes(1)
  })

  it('renders 3 disabled filter/export/refresh buttons', () => {
    render(<ResultToolbar {...defaultProps} />)
    const comingSoonButtons = screen.getAllByTitle('Coming soon')
    expect(comingSoonButtons).toHaveLength(3)
    comingSoonButtons.forEach((btn) => {
      expect(btn).toBeDisabled()
    })
  })

  it('shows page text', () => {
    render(<ResultToolbar {...defaultProps} currentPage={2} totalPages={5} />)
    expect(screen.getByText('Page 2 of 5')).toBeInTheDocument()
  })

  it('shows execution time', () => {
    render(<ResultToolbar {...defaultProps} executionTimeMs={42} />)
    expect(screen.getByText('(42ms)')).toBeInTheDocument()
  })

  it('truncates long error messages to 200 chars', () => {
    const longError = 'A'.repeat(250)
    render(<ResultToolbar {...defaultProps} status="error" error={longError} columnsCount={0} />)
    // Should truncate to 200 chars + ellipsis
    const displayed = screen.getByText(/^A+/)
    expect(displayed.textContent!.length).toBeLessThanOrEqual(201) // 200 + ellipsis char
  })

  it('shows "ROWS AFFECTED" for DML results', () => {
    render(<ResultToolbar {...defaultProps} totalRows={0} affectedRows={5} columnsCount={0} />)
    expect(screen.getByText('5 ROWS AFFECTED')).toBeInTheDocument()
  })

  it('shows "QUERY OK" for DDL results with no affected rows', () => {
    render(<ResultToolbar {...defaultProps} totalRows={0} affectedRows={0} columnsCount={0} />)
    expect(screen.getByText('QUERY OK')).toBeInTheDocument()
  })

  it('hides pagination in error state', () => {
    render(<ResultToolbar {...defaultProps} status="error" error="Some error" columnsCount={0} />)
    expect(screen.queryByLabelText('Previous page')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument()
  })

  it('hides pagination for DML results (no columns)', () => {
    render(<ResultToolbar {...defaultProps} totalRows={0} affectedRows={3} columnsCount={0} />)
    expect(screen.queryByLabelText('Previous page')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument()
  })
})
