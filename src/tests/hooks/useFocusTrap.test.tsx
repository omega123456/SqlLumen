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
})
