import { useState } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RetainedView } from '../../../components/shared/RetainedView'

function ClickCounter() {
  const [clickCount, setClickCount] = useState(0)
  return (
    <button type="button" onClick={() => setClickCount(clickCount + 1)}>
      Clicked {clickCount}
    </button>
  )
}

function renderRetainedCounter(isVisible: boolean) {
  return (
    <RetainedView isVisible={isVisible}>
      <ClickCounter />
    </RetainedView>
  )
}

describe('RetainedView', () => {
  it('mounts on first reveal and keeps its state while hidden', async () => {
    const user = userEvent.setup()
    const { rerender } = render(renderRetainedCounter(false))
    expect(screen.queryByText(/Clicked/)).not.toBeInTheDocument()

    rerender(renderRetainedCounter(true))
    await user.click(screen.getByRole('button', { name: 'Clicked 0' }))
    const counter = screen.getByText('Clicked 1')

    rerender(renderRetainedCounter(false))
    expect(counter).toBeInTheDocument()
    expect(counter).not.toBeVisible()

    rerender(renderRetainedCounter(true))
    expect(screen.getByText('Clicked 1')).toBe(counter)
    expect(counter).toBeVisible()
  })
})
