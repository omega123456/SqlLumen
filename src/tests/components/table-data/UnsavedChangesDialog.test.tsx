import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UnsavedChangesDialog } from '../../../components/shared/UnsavedChangesDialog'
import { UnsavedChangesDialog as ReExportedDialog } from '../../../components/table-data/UnsavedChangesDialog'

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

  async function clickSave(): Promise<void> {
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('btn-save-changes'))
  }

  it('renders title and message', () => {
    render(<UnsavedChangesDialog {...defaultProps} />)
    expect(screen.getByText('Unsaved Changes')).toBeInTheDocument()
    expect(screen.getByText(/You have unsaved changes on the current row/)).toBeInTheDocument()
  })

  it('Save button triggers onSave', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<UnsavedChangesDialog {...defaultProps} onSave={onSave} />)
    await clickSave()
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1)
    })
  })

  it('Discard button triggers onDiscard', async () => {
    const user = userEvent.setup()
    const onDiscard = vi.fn()
    render(<UnsavedChangesDialog {...defaultProps} onDiscard={onDiscard} />)
    await user.click(await screen.findByTestId('btn-discard-changes'))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('Cancel button triggers onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<UnsavedChangesDialog {...defaultProps} onCancel={onCancel} />)
    await user.click(await screen.findByTestId('btn-cancel-changes'))
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

  it('renders custom title, message, and button labels', () => {
    render(
      <UnsavedChangesDialog
        {...defaultProps}
        title="Unsaved Schema Changes"
        message="You have unsaved table design changes."
        saveLabel="Apply Changes"
        discardLabel="Discard Design"
        cancelLabel="Keep Editing"
      />
    )

    expect(screen.getByText('Unsaved Schema Changes')).toBeInTheDocument()
    expect(screen.getByText('You have unsaved table design changes.')).toBeInTheDocument()
    expect(screen.getByText('Apply Changes')).toBeInTheDocument()
    expect(screen.getByText('Discard Design')).toBeInTheDocument()
    expect(screen.getByText('Keep Editing')).toBeInTheDocument()
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

  it('re-export from table-data path renders identically', () => {
    render(<ReExportedDialog {...defaultProps} />)
    expect(screen.getByTestId('unsaved-changes-dialog')).toBeInTheDocument()
    expect(screen.getByText('Unsaved Changes')).toBeInTheDocument()
  })

  it('shows an internal error when onSave rejects', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Save failed hard'))

    render(<UnsavedChangesDialog {...defaultProps} onSave={onSave} />)

    await clickSave()

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-changes-error')).toHaveTextContent('Save failed hard')
    })
    expect(screen.getByTestId('btn-save-changes')).not.toBeDisabled()
  })

  it('stringifies non-Error save failures for the internal error message', async () => {
    const onSave = vi.fn().mockRejectedValue('Plain failure')

    render(<UnsavedChangesDialog {...defaultProps} onSave={onSave} />)

    await clickSave()

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-changes-error')).toHaveTextContent('Plain failure')
    })
  })

  it('prefers the external error over the internal error state', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Internal error'))

    render(
      <UnsavedChangesDialog
        {...defaultProps}
        onSave={onSave}
        error="External error"
      />
    )

    await clickSave()

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-changes-error')).toHaveTextContent('External error')
    })
  })

  it('renders custom ReactNode messages', () => {
    render(
      <UnsavedChangesDialog
        {...defaultProps}
        message={<span>You have <strong>unsaved</strong> edits.</span>}
      />
    )

    expect(screen.getByText('unsaved')).toBeInTheDocument()
    expect(screen.getByText('You have', { exact: false })).toBeInTheDocument()
  })
})
