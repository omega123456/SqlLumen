/**
 * Tests for shared toolbar item components:
 * ViewModeGroup, PaginationGroup, ExportButton, StatusArea
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ViewModeGroup } from '../../../../components/shared/toolbar/ViewModeGroup'
import { PaginationGroup } from '../../../../components/shared/toolbar/PaginationGroup'
import { ExportButton } from '../../../../components/shared/toolbar/ExportButton'
import { StatusArea } from '../../../../components/shared/toolbar/StatusArea'
import type { ViewMode } from '../../../../types/shared-data-view'
import styles from '../../../../components/shared/toolbar/toolbar-items.module.css'

// ---------------------------------------------------------------------------
// ViewModeGroup
// ---------------------------------------------------------------------------

describe('ViewModeGroup', () => {
  it('renders all available modes', () => {
    const modes: ViewMode[] = ['grid', 'form', 'text']
    render(<ViewModeGroup currentMode="grid" availableModes={modes} onModeChange={() => {}} />)

    expect(screen.getByTestId('view-mode-grid')).toBeInTheDocument()
    expect(screen.getByTestId('view-mode-form')).toBeInTheDocument()
    expect(screen.getByTestId('view-mode-text')).toBeInTheDocument()
  })

  it('renders only two modes when given two', () => {
    const modes: ViewMode[] = ['grid', 'form']
    render(<ViewModeGroup currentMode="grid" availableModes={modes} onModeChange={() => {}} />)

    expect(screen.getByTestId('view-mode-grid')).toBeInTheDocument()
    expect(screen.getByTestId('view-mode-form')).toBeInTheDocument()
    expect(screen.queryByTestId('view-mode-text')).not.toBeInTheDocument()
  })

  it('highlights the active mode', () => {
    render(
      <ViewModeGroup
        currentMode="form"
        availableModes={['grid', 'form', 'text']}
        onModeChange={() => {}}
      />
    )

    const gridBtn = screen.getByTestId('view-mode-grid')
    const formBtn = screen.getByTestId('view-mode-form')
    const textBtn = screen.getByTestId('view-mode-text')

    // The active button should have the viewModeActive class
    expect(formBtn.className).toContain('viewModeActive')
    expect(gridBtn.className).not.toContain('viewModeActive')
    expect(textBtn.className).not.toContain('viewModeActive')
  })

  it('calls onModeChange when a mode button is clicked', () => {
    const onModeChange = vi.fn()
    render(
      <ViewModeGroup
        currentMode="grid"
        availableModes={['grid', 'form', 'text']}
        onModeChange={onModeChange}
      />
    )

    fireEvent.click(screen.getByTestId('view-mode-text'))
    expect(onModeChange).toHaveBeenCalledWith('text')

    fireEvent.click(screen.getByTestId('view-mode-form'))
    expect(onModeChange).toHaveBeenCalledWith('form')
  })

  it('uses custom testIdPrefix', () => {
    render(
      <ViewModeGroup
        currentMode="grid"
        availableModes={['grid', 'form']}
        onModeChange={() => {}}
        testIdPrefix="custom"
      />
    )

    expect(screen.getByTestId('custom-grid')).toBeInTheDocument()
    expect(screen.getByTestId('custom-form')).toBeInTheDocument()
    expect(screen.getByTestId('custom-group')).toBeInTheDocument()
  })

  it('sets correct title attributes', () => {
    render(
      <ViewModeGroup
        currentMode="grid"
        availableModes={['grid', 'form', 'text']}
        onModeChange={() => {}}
      />
    )

    expect(screen.getByTitle('Grid view')).toBeInTheDocument()
    expect(screen.getByTitle('Form view')).toBeInTheDocument()
    expect(screen.getByTitle('Text view')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// PaginationGroup
// ---------------------------------------------------------------------------

describe('PaginationGroup', () => {
  it('renders page size select with all options', async () => {
    const user = userEvent.setup()
    render(
      <PaginationGroup
        currentPage={1}
        totalPages={5}
        pageSize={1000}
        onPageSizeChange={() => {}}
        onPrevPage={() => {}}
        onNextPage={() => {}}
      />
    )

    const combo = screen.getByTestId('page-size-select')
    expect(combo).toBeInTheDocument()
    expect(combo).toHaveTextContent('1000')

    await user.click(combo)
    const labels = screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'))
    expect(labels).toEqual(['100', '500', '1000', '5000'])
  })

  it('renders page indicator text', () => {
    render(
      <PaginationGroup
        currentPage={3}
        totalPages={10}
        pageSize={500}
        onPageSizeChange={() => {}}
        onPrevPage={() => {}}
        onNextPage={() => {}}
      />
    )

    expect(screen.getByTestId('page-indicator')).toHaveTextContent('Page 3 of 10')
  })

  it('renders prev and next navigation buttons', () => {
    render(
      <PaginationGroup
        currentPage={2}
        totalPages={5}
        pageSize={1000}
        onPageSizeChange={() => {}}
        onPrevPage={() => {}}
        onNextPage={() => {}}
      />
    )

    expect(screen.getByTestId('pagination-prev')).toBeInTheDocument()
    expect(screen.getByTestId('pagination-next')).toBeInTheDocument()
  })

  it('disables prev button on page 1', () => {
    render(
      <PaginationGroup
        currentPage={1}
        totalPages={5}
        pageSize={1000}
        onPageSizeChange={() => {}}
        onPrevPage={() => {}}
        onNextPage={() => {}}
      />
    )

    expect(screen.getByTestId('pagination-prev')).toBeDisabled()
    expect(screen.getByTestId('pagination-next')).not.toBeDisabled()
  })

  it('disables next button on last page', () => {
    render(
      <PaginationGroup
        currentPage={5}
        totalPages={5}
        pageSize={1000}
        onPageSizeChange={() => {}}
        onPrevPage={() => {}}
        onNextPage={() => {}}
      />
    )

    expect(screen.getByTestId('pagination-prev')).not.toBeDisabled()
    expect(screen.getByTestId('pagination-next')).toBeDisabled()
  })

  it('disables both buttons when disabled prop is true', () => {
    render(
      <PaginationGroup
        currentPage={3}
        totalPages={5}
        pageSize={1000}
        disabled={true}
        onPageSizeChange={() => {}}
        onPrevPage={() => {}}
        onNextPage={() => {}}
      />
    )

    expect(screen.getByTestId('pagination-prev')).toBeDisabled()
    expect(screen.getByTestId('pagination-next')).toBeDisabled()
  })

  it('calls onPrevPage when prev button is clicked', () => {
    const onPrevPage = vi.fn()
    render(
      <PaginationGroup
        currentPage={3}
        totalPages={5}
        pageSize={1000}
        onPageSizeChange={() => {}}
        onPrevPage={onPrevPage}
        onNextPage={() => {}}
      />
    )

    fireEvent.click(screen.getByTestId('pagination-prev'))
    expect(onPrevPage).toHaveBeenCalledOnce()
  })

  it('calls onNextPage when next button is clicked', () => {
    const onNextPage = vi.fn()
    render(
      <PaginationGroup
        currentPage={3}
        totalPages={5}
        pageSize={1000}
        onPageSizeChange={() => {}}
        onPrevPage={() => {}}
        onNextPage={onNextPage}
      />
    )

    fireEvent.click(screen.getByTestId('pagination-next'))
    expect(onNextPage).toHaveBeenCalledOnce()
  })

  it('calls onPageSizeChange with parsed number', async () => {
    const user = userEvent.setup()
    const onPageSizeChange = vi.fn()
    render(
      <PaginationGroup
        currentPage={1}
        totalPages={5}
        pageSize={1000}
        onPageSizeChange={onPageSizeChange}
        onPrevPage={() => {}}
        onNextPage={() => {}}
      />
    )

    await user.click(screen.getByTestId('page-size-select'))
    await user.click(screen.getByRole('option', { name: '500' }))
    expect(onPageSizeChange).toHaveBeenCalledWith(500)
  })

  it('uses compact trigger styling for the page size dropdown', async () => {
    const user = userEvent.setup()
    render(
      <PaginationGroup
        currentPage={1}
        totalPages={5}
        pageSize={1000}
        onPageSizeChange={() => {}}
        onPrevPage={() => {}}
        onNextPage={() => {}}
      />
    )

    const trigger = screen.getByTestId('page-size-select')
    expect(trigger.className).toContain(styles.pageSizeSelect)

    await user.click(trigger)

    const listbox = screen.getByRole('listbox', { name: 'Page size' })
    await waitFor(() => expect(listbox).toBeInTheDocument())
  })

  it('has correct aria-labels', () => {
    render(
      <PaginationGroup
        currentPage={1}
        totalPages={5}
        pageSize={1000}
        onPageSizeChange={() => {}}
        onPrevPage={() => {}}
        onNextPage={() => {}}
      />
    )

    expect(screen.getByLabelText('Page size')).toBeInTheDocument()
    expect(screen.getByLabelText('Previous page')).toBeInTheDocument()
    expect(screen.getByLabelText('Next page')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// ExportButton
// ---------------------------------------------------------------------------

describe('ExportButton', () => {
  it('renders with Export text', () => {
    render(<ExportButton onClick={() => {}} />)

    const btn = screen.getByTestId('btn-export')
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveTextContent('Export')
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<ExportButton onClick={onClick} />)

    fireEvent.click(screen.getByTestId('btn-export'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('can be disabled', () => {
    render(<ExportButton disabled={true} onClick={() => {}} />)

    expect(screen.getByTestId('btn-export')).toBeDisabled()
  })

  it('is not disabled by default', () => {
    render(<ExportButton onClick={() => {}} />)

    expect(screen.getByTestId('btn-export')).not.toBeDisabled()
  })

  it('uses custom testId', () => {
    render(<ExportButton onClick={() => {}} testId="custom-export" />)

    expect(screen.getByTestId('custom-export')).toBeInTheDocument()
  })

  it('uses default testId when not provided', () => {
    render(<ExportButton onClick={() => {}} />)

    expect(screen.getByTestId('btn-export')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// StatusArea
// ---------------------------------------------------------------------------

describe('StatusArea', () => {
  it('renders nothing visible for idle status', () => {
    render(<StatusArea status="idle" />)

    const area = screen.getByTestId('status-area')
    expect(area).toBeInTheDocument()
    // No loading, success, or error should be rendered
    expect(screen.queryByTestId('status-loading')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-success')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-error')).not.toBeInTheDocument()
  })

  it('renders loading indicator', () => {
    render(<StatusArea status="loading" />)

    expect(screen.getByTestId('status-loading')).toBeInTheDocument()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders success state with row count', () => {
    render(<StatusArea status="success" totalRows={42} />)

    expect(screen.getByTestId('status-success')).toBeInTheDocument()
    expect(screen.getByText('42 Rows')).toBeInTheDocument()
  })

  it('renders success state with row count and execution time', () => {
    render(<StatusArea status="success" totalRows={100} executionTimeMs={250} />)

    expect(screen.getByTestId('status-success')).toBeInTheDocument()
    expect(screen.getByText('100 Rows')).toBeInTheDocument()
    expect(screen.getByTestId('status-execution-time')).toHaveTextContent('(250ms)')
  })

  it('renders success state without execution time when not provided', () => {
    render(<StatusArea status="success" totalRows={50} />)

    expect(screen.getByTestId('status-success')).toBeInTheDocument()
    expect(screen.queryByTestId('status-execution-time')).not.toBeInTheDocument()
  })

  it('renders success fallback text when totalRows is not provided', () => {
    render(<StatusArea status="success" />)

    expect(screen.getByTestId('status-success')).toBeInTheDocument()
    expect(screen.getByText('Success')).toBeInTheDocument()
  })

  it('renders error state with message', () => {
    render(<StatusArea status="error" errorMessage="Connection refused" />)

    expect(screen.getByTestId('status-error')).toBeInTheDocument()
    expect(screen.getByText('Connection refused')).toBeInTheDocument()
  })

  it('renders error state with fallback when no message provided', () => {
    render(<StatusArea status="error" />)

    expect(screen.getByTestId('status-error')).toBeInTheDocument()
    expect(screen.getByText('Error')).toBeInTheDocument()
  })

  it('renders customContent prop', () => {
    render(
      <StatusArea
        status="success"
        totalRows={10}
        customContent={<span data-testid="custom">Extra info</span>}
      />
    )

    expect(screen.getByTestId('custom')).toBeInTheDocument()
    expect(screen.getByText('Extra info')).toBeInTheDocument()
  })

  it('renders customContent with idle status', () => {
    render(
      <StatusArea
        status="idle"
        customContent={<span data-testid="custom-idle">Idle content</span>}
      />
    )

    expect(screen.queryByTestId('status-loading')).not.toBeInTheDocument()
    expect(screen.queryByTestId('status-success')).not.toBeInTheDocument()
    expect(screen.getByTestId('custom-idle')).toBeInTheDocument()
  })

  it('renders 0 rows correctly in success state', () => {
    render(<StatusArea status="success" totalRows={0} />)

    expect(screen.getByTestId('status-success')).toBeInTheDocument()
    expect(screen.getByText('0 Rows')).toBeInTheDocument()
  })
})
