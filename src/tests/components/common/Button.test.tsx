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
    expect(btn).toHaveAttribute('data-variant', 'default')
    expect(btn).toHaveAttribute('data-size', 'md')
    expect(btn).not.toHaveAttribute('data-icon-only')
    expect(btn).not.toHaveAttribute('data-danger-text')
  })

  it.each(['accent', 'subtle', 'subtleMuted', 'subtleToggled', 'danger'] as const)(
    'exposes the %s variant as its lookup key',
    (variant) => {
      render(<Button variant={variant}>{variant}</Button>)
      expect(screen.getByRole('button')).toHaveAttribute('data-variant', variant)
    }
  )

  it('exposes the content alignment as a lookup key', () => {
    render(
      <>
        <Button data-testid="centered">A</Button>
        <Button contentAlign="start" data-testid="started">
          B
        </Button>
      </>
    )
    expect(screen.getByTestId('centered')).toHaveAttribute('data-align', 'center')
    expect(screen.getByTestId('started')).toHaveAttribute('data-align', 'start')
  })

  it('keeps the bare variant free of styling attributes', () => {
    render(
      <Button variant="bare" size="sm" iconOnly dangerText>
        Bare
      </Button>
    )
    const btn = screen.getByRole('button', { name: 'Bare' })
    expect(btn).toHaveAttribute('data-variant', 'bare')
    expect(btn).toHaveAttribute('type', 'button')
  })

  it('combines danger text with every styled variant', () => {
    const variants = ['default', 'accent', 'subtle', 'danger'] as const
    for (const variant of variants) {
      const { unmount } = render(
        <Button variant={variant} dangerText>
          {variant}
        </Button>
      )
      expect(screen.getByRole('button')).toHaveAttribute('data-danger-text', 'true')
      unmount()
    }
  })

  it('exposes the size, icon-only and danger-text lookup keys', () => {
    render(
      <Button variant="subtle" size="sm" iconOnly dangerText aria-label="Delete row">
        x
      </Button>
    )
    const btn = screen.getByRole('button', { name: 'Delete row' })
    expect(btn).toHaveAttribute('data-variant', 'subtle')
    expect(btn).toHaveAttribute('data-size', 'sm')
    expect(btn).toHaveAttribute('data-icon-only', 'true')
    expect(btn).toHaveAttribute('data-danger-text', 'true')
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
