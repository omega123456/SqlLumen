import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SplitButton } from '../../../components/common/SplitButton'

function renderSplitButton(disabled = false) {
  const onClick = vi.fn()
  const onSelect = vi.fn()
  render(
    <SplitButton
      onClick={onClick}
      disabled={disabled}
      menuLabel="More run options"
      menuItems={[{ key: 'extra', label: 'Extra action', onSelect: onSelect }]}
      testId="run"
    >
      Run
    </SplitButton>
  )
  return { onClick, onSelect }
}

describe('SplitButton', () => {
  it('runs the primary action and toggles, selects from and dismisses the menu', async () => {
    const user = userEvent.setup()
    const { onClick, onSelect } = renderSplitButton()
    const trigger = screen.getByRole('button', { name: 'More run options' })

    await user.click(screen.getByTestId('run'))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu')).toHaveAttribute('data-testid', 'run-menu')
    await user.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'Extra action' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(trigger)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('disables both segments together', () => {
    renderSplitButton(true)
    expect(screen.getByTestId('run')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'More run options' })).toBeDisabled()
  })
})
