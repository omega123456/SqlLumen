import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { useRef } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'

/** Test component that uses useFocusTrap */
function TestDialog({ isOpen }: { isOpen: boolean }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, isOpen)

  if (!isOpen) return null

  return (
    <div ref={dialogRef} data-testid="dialog">
      <input data-testid="input1" type="text" />
      <button data-testid="btn1">OK</button>
      <button data-testid="btn2">Cancel</button>
    </div>
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('useFocusTrap', () => {
  it('focuses first focusable element on open', async () => {
    const { getByTestId } = render(<TestDialog isOpen={true} />)

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })

    const input1 = getByTestId('input1')
    expect(document.activeElement).toBe(input1)
  })

  it('does not render anything when not open', () => {
    const { queryByTestId } = render(<TestDialog isOpen={false} />)
    expect(queryByTestId('dialog')).not.toBeInTheDocument()
  })

  it('registers keydown listener on document when open', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    render(<TestDialog isOpen={true} />)

    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    addSpy.mockRestore()
  })

  it('removes keydown listener on close', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { rerender } = render(<TestDialog isOpen={true} />)

    rerender(<TestDialog isOpen={false} />)

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    removeSpy.mockRestore()
  })

  it('restores focus to previously-focused element on close', async () => {
    const externalButton = document.createElement('button')
    externalButton.textContent = 'External'
    document.body.appendChild(externalButton)
    externalButton.focus()
    expect(document.activeElement).toBe(externalButton)

    const { rerender } = render(<TestDialog isOpen={true} />)
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })

    // Focus should have moved to the dialog's first focusable element
    expect(document.activeElement).not.toBe(externalButton)

    // Close the dialog
    rerender(<TestDialog isOpen={false} />)

    // Focus should be restored to the external button
    expect(document.activeElement).toBe(externalButton)

    document.body.removeChild(externalButton)
  })

  it('does not focus anything when dialog has no focusable elements', async () => {
    function EmptyDialog({ isOpen }: { isOpen: boolean }) {
      const ref = useRef<HTMLDivElement>(null)
      useFocusTrap(ref, isOpen)
      if (!isOpen) return null
      return (
        <div ref={ref} data-testid="empty-dialog">
          <p>No focusable elements</p>
        </div>
      )
    }

    const prevActive = document.activeElement
    render(<EmptyDialog isOpen={true} />)

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })

    // Focus should not have changed since there's nothing to focus
    expect(document.activeElement).toBe(prevActive)
  })

  it('does not register listener when isOpen is false', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    render(<TestDialog isOpen={false} />)

    const keydownCalls = addSpy.mock.calls.filter(([type]) => type === 'keydown')
    expect(keydownCalls).toHaveLength(0)
    addSpy.mockRestore()
  })
})
