import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InfoCellPopover } from '../../../components/processlist/InfoCellPopover'

const mockShowSuccessToast = vi.fn()
const mockShowErrorToast = vi.fn()

vi.mock('../../../lib/context-menu-utils', () => ({
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
  readClipboardText: vi.fn().mockResolvedValue(''),
  getContextMenuPortalRoot: vi.fn().mockReturnValue(document.body),
  positionContextMenuInPortal: vi.fn().mockReturnValue({ x: 0, y: 0 }),
}))

vi.mock('../../../stores/toast-store', () => ({
  showSuccessToast: (...args: unknown[]) => mockShowSuccessToast(...args),
  showErrorToast: (...args: unknown[]) => mockShowErrorToast(...args),
}))

describe('InfoCellPopover', () => {
  let anchor: HTMLDivElement

  beforeEach(() => {
    anchor = document.createElement('div')
    anchor.getBoundingClientRect = () => ({
      top: 100,
      bottom: 120,
      left: 50,
      right: 200,
      width: 150,
      height: 20,
      x: 50,
      y: 100,
      toJSON: () => {},
    })
    document.body.appendChild(anchor)
  })

  afterEach(() => {
    anchor.remove()
    vi.clearAllMocks()
  })

  it('renders nothing when sql is null', () => {
    const { container } = render(<InfoCellPopover sql={null} anchorEl={null} onClose={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders popover when sql and anchor are provided', () => {
    render(<InfoCellPopover sql="SELECT * FROM users" anchorEl={anchor} onClose={vi.fn()} />)
    expect(screen.getByTestId('info-cell-popover')).toBeInTheDocument()
    expect(screen.getByText('SELECT * FROM users')).toBeInTheDocument()
  })

  it('renders copy button', () => {
    render(<InfoCellPopover sql="SELECT 1" anchorEl={anchor} onClose={vi.fn()} />)
    expect(screen.getByTestId('info-popover-copy')).toBeInTheDocument()
  })

  it('calls onClose on Escape key', async () => {
    const onClose = vi.fn()
    render(<InfoCellPopover sql="SELECT 1" anchorEl={anchor} onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows success toast after copying SQL', async () => {
    render(<InfoCellPopover sql="SELECT 1" anchorEl={anchor} onClose={vi.fn()} />)

    await userEvent.click(screen.getByTestId('info-popover-copy'))

    await vi.waitFor(() => {
      expect(mockShowSuccessToast).toHaveBeenCalledWith('Copied to clipboard')
    })
  })

  it('shows error toast when copying SQL fails', async () => {
    const { writeClipboardText } = await import('../../../lib/context-menu-utils')
    vi.mocked(writeClipboardText).mockRejectedValueOnce(new Error('clipboard denied'))

    render(<InfoCellPopover sql="SELECT 1" anchorEl={anchor} onClose={vi.fn()} />)

    await userEvent.click(screen.getByTestId('info-popover-copy'))

    await vi.waitFor(() => {
      expect(mockShowErrorToast).toHaveBeenCalledWith('Copy failed', 'clipboard denied')
    })
  })
})
