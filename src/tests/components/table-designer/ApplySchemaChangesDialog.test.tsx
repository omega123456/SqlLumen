import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApplySchemaChangesDialog } from '../../../components/table-designer/ApplySchemaChangesDialog'

vi.mock('../../../lib/table-designer-commands', () => ({
  applyTableDdl: vi.fn(),
}))

vi.mock('../../../stores/toast-store', () => ({
  showSuccessToast: vi.fn(),
  showErrorToast: vi.fn(),
}))

import { applyTableDdl } from '../../../lib/table-designer-commands'
import { showErrorToast, showSuccessToast } from '../../../stores/toast-store'

describe('ApplySchemaChangesDialog', () => {
  const defaultProps = {
    isOpen: true,
    ddl: 'ALTER TABLE `users` ADD COLUMN `nickname` VARCHAR(64);',
    warnings: [] as string[],
    connectionId: 'conn-1',
    database: 'app_db',
    schemaMode: 'alter' as const,
    tableLabel: 'app_db.users',
    onSuccess: vi.fn(),
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(applyTableDdl).mockResolvedValue(undefined)
  })

  it('renders DDL code block content', () => {
    render(<ApplySchemaChangesDialog {...defaultProps} />)
    expect(screen.getByTestId('apply-schema-ddl')).toHaveTextContent('ALTER TABLE `users`')
  })

  it('shows rename warning section when warnings non-empty', () => {
    render(
      <ApplySchemaChangesDialog {...defaultProps} warnings={['Column rename may rebuild table']} />
    )
    expect(screen.getByTestId('apply-schema-warnings')).toBeInTheDocument()
    expect(screen.getByText('Column rename may rebuild table')).toBeInTheDocument()
  })

  it('warning section absent when warnings empty', () => {
    render(<ApplySchemaChangesDialog {...defaultProps} warnings={[]} />)
    expect(screen.queryByTestId('apply-schema-warnings')).not.toBeInTheDocument()
  })

  it('Cancel button calls onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<ApplySchemaChangesDialog {...defaultProps} onCancel={onCancel} />)
    await user.click(screen.getByTestId('apply-schema-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Execute Changes button calls applyTableDdl and onSuccess on success', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(<ApplySchemaChangesDialog {...defaultProps} onSuccess={onSuccess} />)

    await user.click(screen.getByTestId('apply-schema-confirm'))

    await waitFor(() => {
      expect(applyTableDdl).toHaveBeenCalledWith(
        'conn-1',
        'app_db',
        'ALTER TABLE `users` ADD COLUMN `nickname` VARCHAR(64);'
      )
    })
    expect(showSuccessToast).toHaveBeenCalledWith('Table updated', 'app_db.users')
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('shows Table created success toast when schemaMode is create', async () => {
    const user = userEvent.setup()
    render(
      <ApplySchemaChangesDialog
        {...defaultProps}
        schemaMode="create"
        tableLabel="app_db.audit_log"
        ddl="CREATE TABLE `audit_log` (`id` INT);"
      />
    )

    await user.click(screen.getByTestId('apply-schema-confirm'))

    await waitFor(() => {
      expect(showSuccessToast).toHaveBeenCalledWith('Table created', 'app_db.audit_log')
    })
  })

  it('shows error message below code block on IPC failure', async () => {
    const user = userEvent.setup()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(applyTableDdl).mockRejectedValueOnce(new Error('DDL apply failed'))

    try {
      render(<ApplySchemaChangesDialog {...defaultProps} />)
      await user.click(screen.getByTestId('apply-schema-confirm'))

      await waitFor(() => {
        expect(screen.getByTestId('apply-schema-error')).toHaveTextContent('DDL apply failed')
      })
      expect(showErrorToast).toHaveBeenCalledWith(
        'Failed to apply schema changes',
        'DDL apply failed'
      )
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('Execute Changes button disabled while in-flight', async () => {
    const user = userEvent.setup()
    let resolvePromise: (() => void) | undefined
    vi.mocked(applyTableDdl).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePromise = resolve
        })
    )

    render(<ApplySchemaChangesDialog {...defaultProps} />)
    await user.click(screen.getByTestId('apply-schema-confirm'))

    expect(screen.getByTestId('apply-schema-confirm')).toBeDisabled()
    expect(screen.getByTestId('apply-schema-confirm')).toHaveTextContent('Executing...')
    resolvePromise?.()
    await waitFor(() => {
      expect(defaultProps.onSuccess).toHaveBeenCalled()
    })
  })

  it('backdrop click does not close dialog while executing', async () => {
    const user = userEvent.setup()
    let resolvePromise: (() => void) | undefined
    vi.mocked(applyTableDdl).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePromise = resolve
        })
    )

    const onCancel = vi.fn()
    render(<ApplySchemaChangesDialog {...defaultProps} onCancel={onCancel} />)

    await user.click(screen.getByTestId('apply-schema-confirm'))
    await user.click(screen.getByTestId('apply-schema-dialog'))

    expect(onCancel).not.toHaveBeenCalled()

    resolvePromise?.()
    await waitFor(() => {
      expect(defaultProps.onSuccess).toHaveBeenCalled()
    })
  })

  it('Escape key does not close dialog while executing', async () => {
    const user = userEvent.setup()
    let resolvePromise: (() => void) | undefined
    vi.mocked(applyTableDdl).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePromise = resolve
        })
    )

    const onCancel = vi.fn()
    render(<ApplySchemaChangesDialog {...defaultProps} onCancel={onCancel} />)

    await user.click(screen.getByTestId('apply-schema-confirm'))
    await user.keyboard('{Escape}')

    expect(onCancel).not.toHaveBeenCalled()

    resolvePromise?.()
    await waitFor(() => {
      expect(defaultProps.onSuccess).toHaveBeenCalled()
    })
  })
})
