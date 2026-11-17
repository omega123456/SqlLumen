import { createRef, useState } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Checkbox } from '../../../components/common/Checkbox'

function ControlledToggle() {
  const [on, setOn] = useState(false)
  return <Checkbox checked={on} onChange={(e) => setOn(e.target.checked)} aria-label="Toggle me" />
}

describe('Checkbox', () => {
  it('supports controlled toggle', async () => {
    const user = userEvent.setup()
    render(<ControlledToggle />)
    const input = screen.getByRole('checkbox', { name: 'Toggle me' })
    expect(input).not.toBeChecked()
    await user.click(input)
    expect(input).toBeChecked()
    await user.click(input)
    expect(input).not.toBeChecked()
  })

  it('respects disabled', () => {
    render(<Checkbox disabled defaultChecked aria-label="off" />)
    const input = screen.getByRole('checkbox', { name: 'off' })
    expect(input).toBeDisabled()
    expect(input).toBeChecked()
  })

  it('forwards ref', () => {
    const ref = createRef<HTMLInputElement>()
    render(<Checkbox ref={ref} aria-label="ref box" />)
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
    expect(ref.current).toBe(screen.getByRole('checkbox', { name: 'ref box' }))
  })
})
