import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastViewport } from '../../../components/common/ToastViewport'
import { useToastStore, _resetToastTimeoutsForTests } from '../../../stores/toast-store'

describe('ToastViewport', () => {
  beforeEach(() => {
    _resetToastTimeoutsForTests()
    useToastStore.setState({ toasts: [] })
  })

  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastViewport />)
    expect(container.firstChild).toBeNull()
  })

  it('renders success, error, and warning variants with correct roles', () => {
    useToastStore.setState({
      toasts: [
        {
          id: 'a',
          variant: 'success',
          title: 'Done',
          message: 'ok',
          durationMs: 5000,
        },
        {
          id: 'b',
          variant: 'error',
          title: 'Failed',
          message: 'bad',
          durationMs: 5000,
        },
        {
          id: 'c',
          variant: 'warning',
          title: 'FYI',
          durationMs: 5000,
        },
      ],
    })

    render(<ToastViewport />)

    const items = screen.getAllByTestId('toast-item')
    expect(items).toHaveLength(3)

    const success = items.find((el) => el.getAttribute('data-toast-variant') === 'success')
    const err = items.find((el) => el.getAttribute('data-toast-variant') === 'error')
    const warn = items.find((el) => el.getAttribute('data-toast-variant') === 'warning')

    expect(success).toHaveAttribute('role', 'status')
    expect(err).toHaveAttribute('role', 'alert')
    expect(warn).toHaveAttribute('role', 'status')

    expect(within(success!).getByRole('heading', { level: 3 })).toHaveTextContent('Done')
    expect(within(success!).getByText('ok')).toBeInTheDocument()
    expect(within(err!).getByText('bad')).toBeInTheDocument()
    expect(within(warn!).getByRole('heading', { level: 3 })).toHaveTextContent('FYI')
  })

  it('dismiss button removes that toast', async () => {
    const user = userEvent.setup()
    useToastStore.setState({
      toasts: [
        {
          id: 'x',
          variant: 'warning',
          title: 'Close me',
          durationMs: 5000,
        },
      ],
    })

    render(<ToastViewport />)

    await user.click(screen.getByTestId('toast-dismiss'))

    expect(useToastStore.getState().toasts).toHaveLength(0)
    expect(screen.queryByTestId('toast-stack')).not.toBeInTheDocument()
  })
})
