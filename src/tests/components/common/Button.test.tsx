import { createRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '../../../components/common/Button'

describe('Button', () => {
  it('defaults to type button', () => {
    render(<Button>Go</Button>)
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'button')
  })

  it('renders the bare variant without a style lookup key beyond its variant', () => {
    render(
      <Button variant="bare" size="sm" iconOnly dangerText>
        Bare
      </Button>
    )
    const btn = screen.getByRole('button', { name: 'Bare' })
    expect(btn).toHaveAttribute('data-variant', 'bare')
    expect(btn).toHaveAttribute('type', 'button')
  })

  it('accepts the danger text and invalid options on the danger and default variants', () => {
    render(
      <>
        <Button variant="danger" dangerText>
          Drop
        </Button>
        <Button invalid>Pick</Button>
      </>
    )
    expect(screen.getByRole('button', { name: 'Drop' })).toHaveAttribute('data-danger-text', 'true')
    expect(screen.getByRole('button', { name: 'Pick' })).toHaveAttribute('data-invalid', 'true')
  })

  it('forwards ref', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref}>T</Button>)
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
    expect(ref.current).toBe(screen.getByRole('button'))
  })

  it('allows overriding type for submit buttons', () => {
    render(
      <Button type="submit" variant="accent">
        Submit
      </Button>
    )
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveAttribute('type', 'submit')
  })

  it('calls onClick and respects disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { rerender } = render(<Button onClick={onClick}>Click</Button>)
    await user.click(screen.getByRole('button', { name: 'Click' }))
    expect(onClick).toHaveBeenCalledTimes(1)

    rerender(
      <Button onClick={onClick} disabled>
        Click
      </Button>
    )
    await user.click(screen.getByRole('button', { name: 'Click' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
