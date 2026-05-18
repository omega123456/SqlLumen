import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { ColorPickerPopover } from '../../../components/connection-dialog/ColorPickerPopover'

describe('ColorPickerPopover', () => {
  it('should flip popover upward when near the bottom of the viewport', async () => {
    const user = userEvent.setup()

    // Position the swatch near the bottom of the viewport
    render(<ColorPickerPopover color="#ff0000" onChange={() => {}} />)

    const swatch = screen.getByRole('button', { name: 'Choose color' })

    // Mock getBoundingClientRect to simulate the swatch being near the bottom of viewport
    vi.spyOn(swatch, 'getBoundingClientRect').mockReturnValue({
      top: 750,
      bottom: 766,
      left: 100,
      right: 116,
      width: 16,
      height: 16,
      x: 100,
      y: 750,
      toJSON: () => {},
    })

    // Mock window.innerHeight
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true })

    await user.click(swatch)

    const popover = screen.getByTestId('color-picker-popover')

    // The popover should have some indication it's flipped upward
    // (e.g., bottom positioning instead of top, or a data attribute, or a CSS class)
    // Currently the popover ALWAYS opens downward with top: calc(100% + var(--space-xs)).
    // If viewport-aware positioning existed, the popover would use bottom positioning
    // when near the viewport bottom. We check for the presence of any upward-flip logic.
    //
    // The component should apply a class or inline style that positions the popover above
    // the swatch when there isn't enough space below.
    const hasUpwardFlip =
      Array.from(popover.classList).some((c) => c.includes('popoverUp')) ||
      popover.getAttribute('data-placement') === 'top' ||
      popover.style.bottom !== ''

    expect(hasUpwardFlip).toBe(true)
  })

  it('should render popover in a portal (outside wrapper) to avoid overflow:hidden clipping', async () => {
    const user = userEvent.setup()

    // Wrap in a container with overflow:hidden to simulate the dialog
    const { container } = render(
      <div style={{ overflow: 'hidden', position: 'relative', height: '200px' }}>
        <ColorPickerPopover color="#ff0000" onChange={() => {}} />
      </div>
    )

    const swatch = screen.getByRole('button', { name: 'Choose color' })
    await user.click(swatch)

    const popover = screen.getByTestId('color-picker-popover')

    // The popover should NOT be a descendant of the overflow:hidden container.
    // If it uses a portal, it will be attached to document.body directly.
    const overflowContainer = container.firstElementChild!
    const isInsideOverflowContainer = overflowContainer.contains(popover)

    expect(isInsideOverflowContainer).toBe(false)
  })

  it('should portal into the nearest dialog element instead of document.body when inside a dialog', async () => {
    const user = userEvent.setup()

    // Render the color picker inside a <dialog> element, simulating ConnectionDialog usage
    render(
      <dialog open data-testid="test-dialog">
        <div className="dialog-content">
          <ColorPickerPopover color="#ff0000" onChange={() => {}} />
        </div>
      </dialog>
    )

    const swatch = screen.getByRole('button', { name: 'Choose color' })
    await user.click(swatch)

    const popover = screen.getByTestId('color-picker-popover')
    const dialog = screen.getByTestId('test-dialog')

    // The popover must be inside the <dialog> so it stays in the top layer stacking context.
    // If portaled to document.body, it will render behind the dialog's top layer.
    expect(dialog.contains(popover)).toBe(true)
  })
})
