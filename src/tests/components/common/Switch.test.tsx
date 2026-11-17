import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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
})
