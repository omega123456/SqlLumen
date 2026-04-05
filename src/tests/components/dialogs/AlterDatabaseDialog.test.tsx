import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AlterDatabaseDialog } from '../../../components/dialogs/AlterDatabaseDialog'

// Mock schema-commands
vi.mock('../../../lib/schema-commands', () => ({
  alterDatabase: vi.fn(),
  getDatabaseDetails: vi.fn(),
  listCharsets: vi.fn(),
  listCollations: vi.fn(),
}))

import {
  alterDatabase,
  getDatabaseDetails,
  listCharsets,
  listCollations,
} from '../../../lib/schema-commands'

const mockAlterDatabase = vi.mocked(alterDatabase)
const mockGetDatabaseDetails = vi.mocked(getDatabaseDetails)
const mockListCharsets = vi.mocked(listCharsets)
const mockListCollations = vi.mocked(listCollations)

/** Waits until details + encoding fetches finish (avoids act() warnings from async setState). */
async function waitForAlterDatabaseDialogIdle() {
  await waitFor(() => {
    expect(screen.queryByText('Loading database details...')).not.toBeInTheDocument()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetDatabaseDetails.mockResolvedValue({
    name: 'test_db',
    defaultCharacterSet: 'utf8mb4',
    defaultCollation: 'utf8mb4_general_ci',
  })
  mockListCharsets.mockResolvedValue([
    {
      charset: 'utf8mb4',
      description: 'UTF-8 Unicode',
      defaultCollation: 'utf8mb4_general_ci',
      maxLength: 4,
    },
    {
      charset: 'latin1',
      description: 'Latin 1',
      defaultCollation: 'latin1_swedish_ci',
      maxLength: 1,
    },
  ])
  mockListCollations.mockResolvedValue([
    { name: 'utf8mb4_general_ci', charset: 'utf8mb4', isDefault: true },
    { name: 'utf8mb4_unicode_ci', charset: 'utf8mb4', isDefault: false },
    { name: 'latin1_swedish_ci', charset: 'latin1', isDefault: true },
  ])
  mockAlterDatabase.mockResolvedValue(undefined)
})

describe('AlterDatabaseDialog', () => {
  const defaultProps = {
    isOpen: true,
    connectionId: 'conn-1',
    databaseName: 'test_db',
    onSuccess: vi.fn(),
    onCancel: vi.fn(),
  }

  it('fetches current database details on open', async () => {
    render(<AlterDatabaseDialog {...defaultProps} />)

    await waitFor(() => {
      expect(mockGetDatabaseDetails).toHaveBeenCalledWith('conn-1', 'test_db')
    })
    await waitForAlterDatabaseDialogIdle()
  })

  it('pre-fills charset and collation from current values', async () => {
    render(<AlterDatabaseDialog {...defaultProps} />)

    // After loading, the charset dropdown should show utf8mb4
    await waitFor(() => {
      expect(screen.getByText('utf8mb4')).toBeInTheDocument()
    })

    // Collation dropdown should show utf8mb4_general_ci
    expect(screen.getByText('utf8mb4_general_ci')).toBeInTheDocument()
    await waitForAlterDatabaseDialogIdle()
  })

  it('shows loading state while fetching details', () => {
    // Hang all async sources so loading stays true and no late setState after the test ends
    const pending = new Promise<never>(() => {})
    mockGetDatabaseDetails.mockReturnValue(pending)
    mockListCharsets.mockReturnValue(pending)
    mockListCollations.mockReturnValue(pending)
    render(<AlterDatabaseDialog {...defaultProps} />)

    expect(screen.getByText('Loading database details...')).toBeInTheDocument()
  })

  it('calls alterDatabase on confirm', async () => {
    const user = userEvent.setup()
    render(<AlterDatabaseDialog {...defaultProps} />)

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading database details...')).not.toBeInTheDocument()
    })

    await user.click(screen.getByTestId('alter-db-submit-button'))

    await waitFor(() => {
      expect(mockAlterDatabase).toHaveBeenCalledWith(
        'conn-1',
        'test_db',
        'utf8mb4',
        'utf8mb4_general_ci'
      )
    })
  })

  it('calls onSuccess after successful alter', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(<AlterDatabaseDialog {...defaultProps} onSuccess={onSuccess} />)

    await waitFor(() => {
      expect(screen.queryByText('Loading database details...')).not.toBeInTheDocument()
    })

    await user.click(screen.getByTestId('alter-db-submit-button'))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
  })

  it('shows error if backend fails', async () => {
    mockAlterDatabase.mockRejectedValue(new Error('Permission denied'))
    const user = userEvent.setup()
    render(<AlterDatabaseDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.queryByText('Loading database details...')).not.toBeInTheDocument()
    })

    await user.click(screen.getByTestId('alter-db-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('alter-db-error')).toHaveTextContent('Permission denied')
    })

    expect(screen.getByTestId('alter-db-submit-button')).toBeEnabled()
  })

  it('cannot be dismissed while submission is in progress', async () => {
    mockAlterDatabase.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<AlterDatabaseDialog {...defaultProps} onCancel={onCancel} />)

    await waitForAlterDatabaseDialogIdle()
    await user.click(screen.getByTestId('alter-db-submit-button'))

    expect(screen.getByTestId('alter-db-cancel-button')).toBeDisabled()

    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('alter-database-dialog'))

    expect(onCancel).not.toHaveBeenCalled()
  })

  it('has data-testid="alter-database-dialog"', async () => {
    render(<AlterDatabaseDialog {...defaultProps} />)
    expect(screen.getByTestId('alter-database-dialog')).toBeInTheDocument()
    await waitForAlterDatabaseDialogIdle()
  })

  it('does not render when isOpen is false', () => {
    render(<AlterDatabaseDialog {...defaultProps} isOpen={false} />)
    expect(screen.queryByTestId('alter-database-dialog')).not.toBeInTheDocument()
  })

  it('displays the database name as subtitle', async () => {
    render(<AlterDatabaseDialog {...defaultProps} />)
    expect(screen.getByText('test_db')).toBeInTheDocument()
    await waitForAlterDatabaseDialogIdle()
  })

  it('calls onCancel when cancel button clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const { rerender } = render(<AlterDatabaseDialog {...defaultProps} onCancel={onCancel} />)

    await waitForAlterDatabaseDialogIdle()
    await user.click(screen.getByTestId('alter-db-cancel-button'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    rerender(<AlterDatabaseDialog {...defaultProps} onCancel={onCancel} isOpen={false} />)
  })

  it('Escape key calls onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const { rerender } = render(<AlterDatabaseDialog {...defaultProps} onCancel={onCancel} />)

    await waitForAlterDatabaseDialogIdle()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
    rerender(<AlterDatabaseDialog {...defaultProps} onCancel={onCancel} isOpen={false} />)
  })

  it('shows error when fetching database details fails', async () => {
    mockGetDatabaseDetails.mockRejectedValue(new Error('Connection lost'))
    render(<AlterDatabaseDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('alter-db-error')).toHaveTextContent('Connection lost')
    })
    await waitForAlterDatabaseDialogIdle()
  })

  it('supports toggling from closed to open on the same mounted instance', async () => {
    const { rerender } = render(<AlterDatabaseDialog {...defaultProps} isOpen={false} />)

    rerender(<AlterDatabaseDialog {...defaultProps} isOpen={true} />)

    await waitFor(() => {
      expect(screen.getByTestId('alter-database-dialog')).toBeInTheDocument()
    })
    await waitForAlterDatabaseDialogIdle()
  })

  it('restores fetched database values when reopened after closing with unsaved changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<AlterDatabaseDialog {...defaultProps} isOpen={true} />)

    await waitForAlterDatabaseDialogIdle()
    await user.click(screen.getByRole('combobox', { name: 'Character Set' }))
    await user.click(screen.getByRole('option', { name: /^latin1$/ }))

    expect(screen.getByText('latin1')).toBeInTheDocument()

    rerender(<AlterDatabaseDialog {...defaultProps} isOpen={false} />)
    rerender(<AlterDatabaseDialog {...defaultProps} isOpen={true} />)

    await waitForAlterDatabaseDialogIdle()
    expect(screen.getByText('utf8mb4')).toBeInTheDocument()
    expect(screen.getByText('utf8mb4_general_ci')).toBeInTheDocument()
  })

  it('clears stale submit errors when switching databases while open', async () => {
    const user = userEvent.setup()
    mockAlterDatabase.mockRejectedValueOnce(new Error('Permission denied'))
    mockGetDatabaseDetails
      .mockResolvedValueOnce({
        name: 'test_db',
        defaultCharacterSet: 'utf8mb4',
        defaultCollation: 'utf8mb4_general_ci',
      })
      .mockResolvedValueOnce({
        name: 'other_db',
        defaultCharacterSet: 'latin1',
        defaultCollation: 'latin1_swedish_ci',
      })

    const { rerender } = render(<AlterDatabaseDialog {...defaultProps} isOpen={true} />)

    await waitForAlterDatabaseDialogIdle()
    await user.click(screen.getByTestId('alter-db-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('alter-db-error')).toHaveTextContent('Permission denied')
    })

    rerender(<AlterDatabaseDialog {...defaultProps} databaseName="other_db" isOpen={true} />)

    await waitFor(() => {
      expect(screen.queryByTestId('alter-db-error')).not.toBeInTheDocument()
      expect(screen.getByText('latin1')).toBeInTheDocument()
      expect(screen.getByText('latin1_swedish_ci')).toBeInTheDocument()
    })
  })
})
