import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useRef } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlobPastePopover } from '../../../components/dialogs/BlobPastePopover'
import { bytesToBase64 } from '../../../lib/blob-utils'

const TEXT_BYTES = new TextEncoder().encode('hello world')
const TEXT_B64 = bytesToBase64(TEXT_BYTES)

interface HarnessProps {
  isOpen: boolean
  onClose?: () => void
  onApply?: (bytes: Uint8Array) => void
  onError?: (msg: string) => void
}

/** Renders the popover beside a real anchor button so focus/anchor behave naturally. */
function Harness({ isOpen, onClose, onApply, onError }: HarnessProps) {
  const anchorRef = useRef<HTMLButtonElement>(null)
  return (
    <div>
      <button ref={anchorRef} type="button" data-testid="anchor">
        Paste
      </button>
      <BlobPastePopover
        isOpen={isOpen}
        onClose={onClose ?? (() => {})}
        onApply={onApply ?? (() => {})}
        onError={onError ?? (() => {})}
        anchorRef={anchorRef}
      />
    </div>
  )
}

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(0)
    return 0
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const testId = this.getAttribute('data-testid')
    if (testId === 'anchor') {
      return {
        x: 0,
        y: 220,
        width: 80,
        height: 32,
        top: 220,
        right: 80,
        bottom: 252,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect
    }
    if (testId === 'blob-paste-popover') {
      return {
        x: 0,
        y: 140,
        width: 320,
        height: 180,
        top: 140,
        right: 320,
        bottom: 320,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect
    }
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BlobPastePopover', () => {
  it('renders when open and is hidden when closed', () => {
    const { rerender } = render(<Harness isOpen={false} />)
    expect(screen.queryByTestId('blob-paste-popover')).not.toBeInTheDocument()

    rerender(<Harness isOpen={true} />)
    expect(screen.getByTestId('blob-paste-popover')).toBeInTheDocument()
  })

  it('focuses the textarea when opened', async () => {
    render(<Harness isOpen={true} />)
    await waitFor(() => expect(screen.getByTestId('blob-paste-input')).toHaveFocus())
  })

  it('closes on Escape and returns focus to the anchor', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness isOpen={true} onClose={onClose} />)

    await waitFor(() => expect(screen.getByTestId('blob-paste-input')).toHaveFocus())
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('anchor')).toHaveFocus()
  })

  it('cycles focus forward with Tab inside the popover', async () => {
    const user = userEvent.setup()
    render(<Harness isOpen={true} />)

    const input = screen.getByTestId('blob-paste-input')
    const apply = screen.getByTestId('blob-paste-apply')

    await waitFor(() => expect(input).toHaveFocus())
    await user.tab()
    expect(apply).toHaveFocus()

    await user.tab()
    expect(input).toHaveFocus()
  })

  it('cycles focus backward with Shift+Tab inside the popover', async () => {
    const user = userEvent.setup()
    render(<Harness isOpen={true} />)

    const input = screen.getByTestId('blob-paste-input')
    const apply = screen.getByTestId('blob-paste-apply')

    await waitFor(() => expect(input).toHaveFocus())
    await user.tab()
    expect(apply).toHaveFocus()

    await user.tab({ shift: true })
    expect(input).toHaveFocus()

    await user.tab({ shift: true })
    expect(apply).toHaveFocus()
  })

  it('closes on outside-click', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness isOpen={true} onClose={onClose} />)

    await user.click(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when clicking inside the popover', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Harness isOpen={true} onClose={onClose} />)

    await user.click(screen.getByTestId('blob-paste-input'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('applies bytes for valid base64 and closes', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const onClose = vi.fn()
    render(<Harness isOpen={true} onApply={onApply} onClose={onClose} />)

    await user.type(screen.getByTestId('blob-paste-input'), TEXT_B64)
    await user.click(screen.getByTestId('blob-paste-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(bytesToBase64(onApply.mock.calls[0][0] as Uint8Array)).toBe(TEXT_B64)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('anchor')).toHaveFocus()
  })

  it('applies bytes for valid hex', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<Harness isOpen={true} onApply={onApply} />)

    // 'hi' = 68 69
    await user.type(screen.getByTestId('blob-paste-input'), '68 69')
    await user.click(screen.getByTestId('blob-paste-apply'))

    expect(bytesToBase64(onApply.mock.calls[0][0] as Uint8Array)).toBe(
      bytesToBase64(new Uint8Array([0x68, 0x69]))
    )
  })

  it('reports an error and stays open for invalid paste', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const onError = vi.fn()
    const onClose = vi.fn()
    render(<Harness isOpen={true} onApply={onApply} onError={onError} onClose={onClose} />)

    await user.type(screen.getByTestId('blob-paste-input'), '!!! not valid @@@')
    await user.click(screen.getByTestId('blob-paste-apply'))

    expect(onError).toHaveBeenCalledTimes(1)
    expect(typeof onError.mock.calls[0][0]).toBe('string')
    expect(onApply).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('blob-paste-popover')).toBeInTheDocument()
  })

  it('flips above the anchor when there is not enough space below', async () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(260)
    render(<Harness isOpen={true} />)

    await waitFor(() =>
      expect(screen.getByTestId('blob-paste-popover')).toHaveAttribute('data-placement', 'above')
    )
  })

  it('keeps the arrow placement metadata in sync with the rendered position', async () => {
    render(<Harness isOpen={true} />)

    await waitFor(() =>
      expect(screen.getByTestId('blob-paste-popover')).toHaveAttribute('data-placement', 'below')
    )
  })
})
