import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Switch } from '../../../components/common/Switch'

describe('Switch', () => {
  it('renders a switch with an Off caption when unchecked', () => {
    render(<Switch aria-label="Wrap" checked={false} onChange={() => {}} />)

    expect(screen.getByRole('switch', { name: 'Wrap' })).not.toBeChecked()
    expect(screen.getByText('Off')).toBeInTheDocument()
  })

  it('shows an On caption when checked', () => {
    render(<Switch aria-label="Wrap" checked onChange={() => {}} />)

    expect(screen.getByRole('switch')).toBeChecked()
    expect(screen.getByText('On')).toBeInTheDocument()
  })

  it('forwards change events and className', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Switch aria-label="Wrap" checked={false} onChange={onChange} className="extra" />)

    const input = screen.getByRole('switch')
    expect(input).toHaveClass('extra')
    await user.click(input)
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
