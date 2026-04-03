import { createRef } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '../../../components/common/Button'

describe('Button', () => {
  it('defaults to type button and primary variant class', () => {
    render(<Button>Go</Button>)
    const btn = screen.getByRole('button', { name: 'Go' })
    expect(btn).toHaveAttribute('type', 'button')
    expect(btn).toHaveClass('ui-button-primary')
  })

  it('maps each variant to the global ui-button class', () => {
    const variants = [
      ['primary', 'ui-button-primary'],
      ['secondary', 'ui-button-secondary'],
      ['test', 'ui-button-test'],
      ['tertiary', 'ui-button-tertiary'],
      ['danger', 'ui-button-danger'],
      ['toolbar', 'ui-button-toolbar'],
      ['ghost', 'ui-button-ghost'],
      ['rowDelete', 'ui-button-row-delete'],
    ] as const

    for (const [variant, expectedClass] of variants) {
      const { unmount } = render(<Button variant={variant}>{variant}</Button>)
      expect(screen.getByRole('button')).toHaveClass(expectedClass)
      unmount()
    }
  })

  it('toolbarDanger variant includes toolbar base and danger modifier classes', () => {
    render(<Button variant="toolbarDanger">Del</Button>)
    const btn = screen.getByRole('button', { name: 'Del' })
    expect(btn).toHaveClass('ui-button-toolbar', 'ui-button-toolbar--danger')
  })

  it('merges className with variant class', () => {
    render(
      <Button variant="secondary" className="extra-slot">
        Save
      </Button>
    )
    const btn = screen.getByRole('button', { name: 'Save' })
    expect(btn).toHaveClass('ui-button-secondary', 'extra-slot')
  })

  it('forwards ref', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Button ref={ref} variant="test">
        T
      </Button>
    )
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
    expect(ref.current).toBe(screen.getByRole('button'))
  })

  it('allows overriding type for submit buttons', () => {
    render(
      <Button type="submit" variant="primary">
        Submit
      </Button>
    )
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveAttribute('type', 'submit')
  })
})
