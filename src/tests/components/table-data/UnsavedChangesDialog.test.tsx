import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UnsavedChangesDialog } from '../../../components/shared/UnsavedChangesDialog'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('UnsavedChangesDialog', () => {
  const defaultProps = {
    tabId: 'tab-1',
    onSave: vi.fn().mockResolvedValue(undefined),
    onDiscard: vi.fn(),
    onCancel: vi.fn(),
  }

  it('renders title and message', () => {
    render(<UnsavedChangesDialog {...defaultProps} />)
    expect(screen.getByText('Unsaved Changes')).toBeInTheDocument()
    expect(screen.getByText(/You have unsaved changes on the current row/)).toBeInTheDocument()
  })

  it('Save button triggers onSave', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<UnsavedChangesDialog {...defaultProps} onSave={onSave} />)
    fireEvent.click(screen.getByTestId('btn-save-changes'))
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1)
    })
  })

  it('Discard button triggers onDiscard', () => {
    const onDiscard = vi.fn()
    render(<UnsavedChangesDialog {...defaultProps} onDiscard={onDiscard} />)
    fireEvent.click(screen.getByTestId('btn-discard-changes'))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('Cancel button triggers onCancel', () => {
    const onCancel = vi.fn()
    render(<UnsavedChangesDialog {...defaultProps} onCancel={onCancel} />)
    fireEvent.click(screen.getByTestId('btn-cancel-changes'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows error message when error prop set', () => {
    render(<UnsavedChangesDialog {...defaultProps} error="Failed to save" />)
    expect(screen.getByTestId('unsaved-changes-error')).toBeInTheDocument()
    expect(screen.getByText('Failed to save')).toBeInTheDocument()
  })

  it('does not show error when error is null', () => {
    render(<UnsavedChangesDialog {...defaultProps} error={null} />)
    expect(screen.queryByTestId('unsaved-changes-error')).not.toBeInTheDocument()
  })

  it('shows loading state when isSaving=true', () => {
    render(<UnsavedChangesDialog {...defaultProps} isSaving={true} />)
    expect(screen.getByTestId('btn-save-changes')).toBeDisabled()
    expect(screen.getByText('Saving...')).toBeInTheDocument()
  })

  it('Save button text says "Save Changes" when not saving', () => {
    render(<UnsavedChangesDialog {...defaultProps} isSaving={false} />)
    expect(screen.getByText('Save Changes')).toBeInTheDocument()
  })

  it('has correct data-testid attributes', () => {
    render(<UnsavedChangesDialog {...defaultProps} />)
    expect(screen.getByTestId('unsaved-changes-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('btn-save-changes')).toBeInTheDocument()
    expect(screen.getByTestId('btn-discard-changes')).toBeInTheDocument()
    expect(screen.getByTestId('btn-cancel-changes')).toBeInTheDocument()
    // The dialog-panel testid is set by DialogShell as `${testId}-panel`
    expect(screen.getByTestId('unsaved-changes-dialog-panel')).toBeInTheDocument()
  })
})
