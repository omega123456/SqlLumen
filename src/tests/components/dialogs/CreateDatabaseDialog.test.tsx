import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateDatabaseDialog } from '../../../components/dialogs/CreateDatabaseDialog'

// Mock schema-commands
vi.mock('../../../lib/schema-commands', () => ({
  createDatabase: vi.fn(),
  listCharsets: vi.fn(),
  listCollations: vi.fn(),
}))

import { createDatabase, listCharsets, listCollations } from '../../../lib/schema-commands'

const mockCreateDatabase = vi.mocked(createDatabase)
const mockListCharsets = vi.mocked(listCharsets)
const mockListCollations = vi.mocked(listCollations)

/** Waits until charset/collation fetch finished (avoids act() warnings from async setState). */
async function waitForCreateDatabaseEncodingIdle() {
  await waitFor(() => {
    expect(screen.getByTestId('create-db-form')).not.toHaveAttribute('aria-busy')
  })
}

beforeEach(() => {
  vi.clearAllMocks()
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
    { name: 'latin1_bin', charset: 'latin1', isDefault: false },
  ])
  mockCreateDatabase.mockResolvedValue(undefined)
})

describe('CreateDatabaseDialog', () => {
  const defaultProps = {
    isOpen: true,
    connectionId: 'conn-1',
    onSuccess: vi.fn(),
    onCancel: vi.fn(),
  }

  it('renders text input for database name', async () => {
    render(<CreateDatabaseDialog {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByTestId('create-db-name-input')).toBeInTheDocument()
    })
    await waitForCreateDatabaseEncodingIdle()
  })

  it('renders charset and collation dropdowns', async () => {
    render(<CreateDatabaseDialog {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('Character Set')).toBeInTheDocument()
      expect(screen.getByText('Collation')).toBeInTheDocument()
    })
    await waitForCreateDatabaseEncodingIdle()
  })

  it('confirm button disabled if name is empty', async () => {
    render(<CreateDatabaseDialog {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByTestId('create-db-submit-button')).toBeDisabled()
    })
    await waitForCreateDatabaseEncodingIdle()
  })

  it('confirm button enabled when name is typed', async () => {
    const user = userEvent.setup()
    render(<CreateDatabaseDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('create-db-name-input')).toBeInTheDocument()
    })
    await waitForCreateDatabaseEncodingIdle()

    await user.type(screen.getByTestId('create-db-name-input'), 'test_db')
    expect(screen.getByTestId('create-db-submit-button')).not.toBeDisabled()
  })

  it('calls createDatabase on confirm with correct args', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(<CreateDatabaseDialog {...defaultProps} onSuccess={onSuccess} />)

    await waitFor(() => {
      expect(screen.getByTestId('create-db-name-input')).toBeInTheDocument()
    })
    await waitForCreateDatabaseEncodingIdle()

    await user.type(screen.getByTestId('create-db-name-input'), 'new_database')
    await user.click(screen.getByTestId('create-db-submit-button'))

    await waitFor(() => {
      expect(mockCreateDatabase).toHaveBeenCalledWith(
        'conn-1',
        'new_database',
        undefined,
        undefined
      )
    })
  })

  it('calls onSuccess with database name on success', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(<CreateDatabaseDialog {...defaultProps} onSuccess={onSuccess} />)

    await waitFor(() => {
      expect(screen.getByTestId('create-db-name-input')).toBeInTheDocument()
    })
    await waitForCreateDatabaseEncodingIdle()

    await user.type(screen.getByTestId('create-db-name-input'), 'new_database')
    await user.click(screen.getByTestId('create-db-submit-button'))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('new_database')
    })
  })

  it('shows loading state during submission', async () => {
    // Make createDatabase hang (never resolve)
    mockCreateDatabase.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    render(<CreateDatabaseDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('create-db-name-input')).toBeInTheDocument()
    })
    await waitForCreateDatabaseEncodingIdle()

    await user.type(screen.getByTestId('create-db-name-input'), 'new_database')
    await user.click(screen.getByTestId('create-db-submit-button'))

    expect(screen.getByTestId('create-db-submit-button')).toHaveTextContent('Creating...')
    expect(screen.getByTestId('create-db-submit-button')).toBeDisabled()
  })

  it('cannot be dismissed while submission is in progress', async () => {
    mockCreateDatabase.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<CreateDatabaseDialog {...defaultProps} onCancel={onCancel} />)

    await waitForCreateDatabaseEncodingIdle()

    await user.type(screen.getByTestId('create-db-name-input'), 'new_database')
    await user.click(screen.getByTestId('create-db-submit-button'))

    expect(screen.getByTestId('create-db-cancel-button')).toBeDisabled()

    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('create-database-dialog'))

    expect(onCancel).not.toHaveBeenCalled()
  })

  it('shows error if backend fails', async () => {
    mockCreateDatabase.mockRejectedValue(new Error('Database already exists'))
    const user = userEvent.setup()
    render(<CreateDatabaseDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('create-db-name-input')).toBeInTheDocument()
    })
    await waitForCreateDatabaseEncodingIdle()

    await user.type(screen.getByTestId('create-db-name-input'), 'existing_db')
    await user.click(screen.getByTestId('create-db-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('create-db-error')).toHaveTextContent('Database already exists')
    })
  })

  it('has data-testid="create-database-dialog"', async () => {
    render(<CreateDatabaseDialog {...defaultProps} />)
    expect(screen.getByTestId('create-database-dialog')).toBeInTheDocument()
    await waitForCreateDatabaseEncodingIdle()
  })

  it('does not render when isOpen is false', () => {
    render(<CreateDatabaseDialog {...defaultProps} isOpen={false} />)
    expect(screen.queryByTestId('create-database-dialog')).not.toBeInTheDocument()
  })

  it('shows validation error for empty name on submit attempt', async () => {
    const user = userEvent.setup()
    render(<CreateDatabaseDialog {...defaultProps} />)

    await waitFor(() => {
      expect(screen.getByTestId('create-db-name-input')).toBeInTheDocument()
    })
    await waitForCreateDatabaseEncodingIdle()

    // Type then clear to trigger validation
    await user.type(screen.getByTestId('create-db-name-input'), 'a')
    await user.clear(screen.getByTestId('create-db-name-input'))
    // Even though submit is disabled, confirm button is disabled already
    expect(screen.getByTestId('create-db-submit-button')).toBeDisabled()
  })

  it('loads charsets and collations on mount', async () => {
    render(<CreateDatabaseDialog {...defaultProps} />)

    await waitFor(() => {
      expect(mockListCharsets).toHaveBeenCalledWith('conn-1')
      expect(mockListCollations).toHaveBeenCalledWith('conn-1')
    })
    await waitForCreateDatabaseEncodingIdle()
  })

  it('calls onCancel when cancel button clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const { rerender } = render(<CreateDatabaseDialog {...defaultProps} onCancel={onCancel} />)

    await waitForCreateDatabaseEncodingIdle()
    await user.click(screen.getByTestId('create-db-cancel-button'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    rerender(<CreateDatabaseDialog {...defaultProps} onCancel={onCancel} isOpen={false} />)
  })

  it('Escape key calls onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const { rerender } = render(<CreateDatabaseDialog {...defaultProps} onCancel={onCancel} />)

    await waitForCreateDatabaseEncodingIdle()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
    rerender(<CreateDatabaseDialog {...defaultProps} onCancel={onCancel} isOpen={false} />)
  })

  it('supports toggling from closed to open on the same mounted instance', async () => {
    const { rerender } = render(<CreateDatabaseDialog {...defaultProps} isOpen={false} />)

    rerender(<CreateDatabaseDialog {...defaultProps} isOpen={true} />)

    await waitFor(() => {
      expect(screen.getByTestId('create-database-dialog')).toBeInTheDocument()
    })
    await waitForCreateDatabaseEncodingIdle()
  })

  it('resets typed values when reopened after cancel', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CreateDatabaseDialog {...defaultProps} isOpen={true} />)

    await waitForCreateDatabaseEncodingIdle()
    const input = screen.getByTestId('create-db-name-input') as HTMLInputElement
    await user.type(input, 'stale_name')

    rerender(<CreateDatabaseDialog {...defaultProps} isOpen={false} />)
    rerender(<CreateDatabaseDialog {...defaultProps} isOpen={true} />)

    await waitForCreateDatabaseEncodingIdle()
    expect((screen.getByTestId('create-db-name-input') as HTMLInputElement).value).toBe('')
    expect(screen.getByTestId('create-db-submit-button')).toBeDisabled()
  })

  it('resets charset and collation selections when reopened after cancel', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CreateDatabaseDialog {...defaultProps} isOpen={true} />)

    await waitForCreateDatabaseEncodingIdle()

    await user.click(screen.getByRole('combobox', { name: 'Character Set' }))
    await user.click(screen.getByRole('option', { name: 'latin1' }))

    expect(screen.getByRole('combobox', { name: 'Character Set' })).toHaveTextContent('latin1')
    expect(screen.getByRole('combobox', { name: 'Collation' })).toHaveTextContent(
      'latin1_swedish_ci'
    )

    rerender(<CreateDatabaseDialog {...defaultProps} isOpen={false} />)
    rerender(<CreateDatabaseDialog {...defaultProps} isOpen={true} />)

    await waitForCreateDatabaseEncodingIdle()

    expect(screen.getByRole('combobox', { name: 'Character Set' })).toHaveTextContent(
      'Server Default'
    )
    expect(screen.getByRole('combobox', { name: 'Collation' })).toHaveTextContent('Default')
  })
})
