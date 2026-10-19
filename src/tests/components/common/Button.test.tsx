import { createRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '../../../components/common/Button'

describe('Button', () => {
  it('defaults to type button, the default variant and the md size', () => {
    render(<Button>Go</Button>)
    const btn = screen.getByRole('button', { name: 'Go' })
    expect(btn).toHaveAttribute('type', 'button')
    expect(btn).toHaveClass('ui-button')
    expect(btn.className).toBe('ui-button')
  })

  it('maps each variant to its modifier class', () => {
    const variants = [
      ['accent', 'ui-button--accent'],
      ['subtle', 'ui-button--subtle'],
      ['danger', 'ui-button--danger'],
    ] as const

    for (const [variant, expectedClass] of variants) {
      const { unmount } = render(<Button variant={variant}>{variant}</Button>)
      const btn = screen.getByRole('button')
      expect(btn).toHaveClass('ui-button', expectedClass)
      unmount()
    }
  })

  it('applies the sm size, icon-only and danger-text modifiers', () => {
    render(
      <Button variant="subtle" size="sm" iconOnly dangerText aria-label="Delete row">
        x
      </Button>
    )
    const btn = screen.getByRole('button', { name: 'Delete row' })
    expect(btn).toHaveClass(
      'ui-button',
      'ui-button--subtle',
      'ui-button--sm',
      'ui-button--icon',
      'ui-button--danger-text'
    )
  })

  it('omits modifiers that are not requested', () => {
    render(<Button variant="accent">Run</Button>)
    const btn = screen.getByRole('button', { name: 'Run' })
    expect(btn).not.toHaveClass('ui-button--sm')
    expect(btn).not.toHaveClass('ui-button--icon')
    expect(btn).not.toHaveClass('ui-button--danger-text')
  })

  it('merges className with the variant classes', () => {
    render(<Button className="extra-slot">Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('ui-button', 'extra-slot')
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
