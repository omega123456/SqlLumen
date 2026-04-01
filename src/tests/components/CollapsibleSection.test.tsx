import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollapsibleSection } from '../../components/connection-dialog/CollapsibleSection'

describe('CollapsibleSection', () => {
  it('uses global ui-subsection surface primitive on the root', () => {
    const { container } = render(
      <CollapsibleSection title="Section A">
        <p>Inner</p>
      </CollapsibleSection>
    )

    const root = container.firstElementChild
    expect(root).not.toBeNull()
    expect(root).toHaveClass('ui-subsection')
  })

  it('toggles content visibility', async () => {
    const user = userEvent.setup()
    render(
      <CollapsibleSection title="SSL certificate files">
        <p>File fields</p>
      </CollapsibleSection>
    )

    const trigger = screen.getByRole('button', { name: /SSL certificate files/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('File fields')).toBeVisible()

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})
