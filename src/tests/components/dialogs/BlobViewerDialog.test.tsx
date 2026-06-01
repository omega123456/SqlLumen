import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlobViewerDialog } from '../../../components/dialogs/BlobViewerDialog'
import { bytesToBase64, formatBytes } from '../../../lib/blob-utils'
import { ipc, expectToast } from '../../ipc-mock'
import type { BlobValueResponse, BlobEnvelope } from '../../../types/schema'

// Native file dialog seam: the plugin-dialog open()/save() helpers invoke
// 'plugin:dialog|open' / 'plugin:dialog|save' under the hood, so route them
// through the shared IPC harness (mirrors ExportDialog/SqlDumpDialog tests).

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
])
const PNG_B64 = bytesToBase64(PNG_BYTES)

// A fuller PNG header with a valid IHDR chunk encoding a 2 × 3 image.
const PNG_WITH_DIMS = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a, // signature
  0x00,
  0x00,
  0x00,
  0x0d, // IHDR length
  0x49,
  0x48,
  0x44,
  0x52, // "IHDR"
  0x00,
  0x00,
  0x00,
  0x02, // width = 2
  0x00,
  0x00,
  0x00,
  0x03, // height = 3
])
const PNG_WITH_DIMS_B64 = bytesToBase64(PNG_WITH_DIMS)

const TEXT_BYTES = new TextEncoder().encode('hello world')
const TEXT_B64 = bytesToBase64(TEXT_BYTES)

function bytesResponse(base64: string | null, byteLength: number): BlobValueResponse {
  return { base64, byteLength, tooLarge: false }
}

beforeEach(() => {
  let counter = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-${counter++}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(0)
    return 0
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BlobViewerDialog', () => {
  const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    mode: 'edit' as const,
    columnLabel: 'photo',
    onApply: vi.fn(),
  }

  it('renders nothing when closed', () => {
    render(<BlobViewerDialog {...baseProps} isOpen={false} initialBase64={TEXT_B64} />)
    expect(screen.queryByTestId('blob-viewer-root')).not.toBeInTheDocument()
  })

  it('lazily fetches bytes via loader and renders the image tab', async () => {
    const loader = vi.fn(async () => bytesResponse(PNG_B64, PNG_BYTES.length))
    render(<BlobViewerDialog {...baseProps} loader={loader} />)
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1))
    expect(await screen.findByTestId('blob-image')).toBeInTheDocument()
  })

  it('switches between Image, Text, and Hex tabs', async () => {
    const user = userEvent.setup()
    render(<BlobViewerDialog {...baseProps} mode="view" initialBase64={TEXT_B64} />)

    // Non-image bytes -> image tab shows the not-an-image state.
    expect(await screen.findByTestId('blob-not-image')).toBeInTheDocument()

    await user.click(screen.getByTestId('blob-tab-text'))
    expect(screen.getByTestId('blob-text')).toHaveTextContent('hello world')

    await user.click(screen.getByTestId('blob-tab-hex'))
    const hex = screen.getByTestId('blob-hex')
    // 'h' = 0x68
    expect(hex).toHaveTextContent('68 65 6c 6c 6f')
  })

  it('renders a valid image for image bytes and not-an-image otherwise', async () => {
    const { unmount } = render(
      <BlobViewerDialog {...baseProps} mode="view" initialBase64={PNG_B64} />
    )
    expect(await screen.findByTestId('blob-image')).toBeInTheDocument()
    unmount()

    render(<BlobViewerDialog {...baseProps} mode="view" initialBase64={TEXT_B64} />)
    expect(await screen.findByTestId('blob-not-image')).toBeInTheDocument()
  })

  it('shows the warning-tinted size chip and in-panel warning when tooLarge', async () => {
    const loader = vi.fn(
      async (): Promise<BlobValueResponse> => ({
        base64: null,
        byteLength: 12 * 1024 * 1024,
        tooLarge: true,
      })
    )
    render(<BlobViewerDialog {...baseProps} loader={loader} />)
    // The byte-size chip carries the warning tint and an alert role.
    const sizeChip = await screen.findByTestId('blob-chip-size')
    expect(sizeChip).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('blob-too-large-content')).toHaveTextContent('Preview limit reached')
    // Save-to-file disabled (no bytes held).
    expect(screen.getByTestId('blob-save-file')).toBeDisabled()
  })

  it('renders the chip row with type, size, and image dimensions', async () => {
    render(<BlobViewerDialog {...baseProps} mode="view" initialBase64={PNG_B64} />)
    await screen.findByTestId('blob-image')

    expect(screen.getByTestId('blob-chip-type')).toHaveTextContent('PNG image')
    expect(screen.getByTestId('blob-chip-size')).toHaveTextContent(formatBytes(PNG_BYTES.length))
  })

  it('shows the dimensions chip for a parseable image', async () => {
    render(<BlobViewerDialog {...baseProps} mode="view" initialBase64={PNG_WITH_DIMS_B64} />)
    await screen.findByTestId('blob-image')
    expect(await screen.findByTestId('blob-chip-dimensions')).toHaveTextContent('2 × 3')
  })

  it('omits the chip row for NULL values', async () => {
    render(<BlobViewerDialog {...baseProps} mode="view" initialBase64={null} />)
    await screen.findByTestId('blob-null-state')
    expect(screen.queryByTestId('blob-chip-row')).not.toBeInTheDocument()
  })

  it('renders the NULL state for a null value', async () => {
    render(<BlobViewerDialog {...baseProps} mode="view" initialBase64={null} />)
    expect(await screen.findByTestId('blob-null-state')).toHaveTextContent('NULL value')
  })

  it('renders the empty state for zero-length bytes', async () => {
    render(<BlobViewerDialog {...baseProps} mode="view" initialBase64="" />)
    expect(await screen.findByTestId('blob-empty-state')).toHaveTextContent('Empty')
  })

  it('shows the Binary type chip for zero-length bytes', async () => {
    render(<BlobViewerDialog {...baseProps} mode="view" initialBase64="" />)

    expect(await screen.findByTestId('blob-empty-state')).toBeInTheDocument()
    expect(screen.getByTestId('blob-chip-type')).toHaveTextContent('Binary')
    expect(screen.getByTestId('blob-chip-size')).toHaveTextContent('0 B')
  })

  it('pastes base64 and applies a bytes envelope', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<BlobViewerDialog {...baseProps} onApply={onApply} initialBase64="" />)

    await user.click(screen.getByTestId('blob-paste-toggle'))
    await user.type(screen.getByTestId('blob-paste-input'), TEXT_B64)
    await user.click(screen.getByTestId('blob-paste-apply'))
    await user.click(screen.getByTestId('blob-apply'))

    const envelope = onApply.mock.calls[0][0] as BlobEnvelope
    expect(envelope.kind).toBe('bytes')
    expect(envelope.base64).toBe(TEXT_B64)
  })

  it('pastes hex and applies a bytes envelope', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<BlobViewerDialog {...baseProps} onApply={onApply} initialBase64="" />)

    await user.click(screen.getByTestId('blob-paste-toggle'))
    // 'hi' = 68 69
    await user.type(screen.getByTestId('blob-paste-input'), '68 69')
    await user.click(screen.getByTestId('blob-paste-apply'))
    await user.click(screen.getByTestId('blob-apply'))

    const envelope = onApply.mock.calls[0][0] as BlobEnvelope
    expect(envelope.kind).toBe('bytes')
    expect(envelope.base64).toBe(bytesToBase64(new Uint8Array([0x68, 0x69])))
  })

  it('Set NULL applies a null envelope', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<BlobViewerDialog {...baseProps} onApply={onApply} initialBase64={TEXT_B64} />)

    await user.click(screen.getByTestId('blob-set-null'))
    await user.click(screen.getByTestId('blob-apply'))

    expect(onApply).toHaveBeenCalledWith({ __sqllumen_blob__: true, kind: 'null' })
  })

  it('Clear applies an empty envelope', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<BlobViewerDialog {...baseProps} onApply={onApply} initialBase64={TEXT_B64} />)

    await user.click(screen.getByTestId('blob-clear'))
    await user.click(screen.getByTestId('blob-apply'))

    expect(onApply).toHaveBeenCalledWith({ __sqllumen_blob__: true, kind: 'empty' })
  })

  it('Load from file reads bytes and applies a bytes envelope', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    ipc.override('plugin:dialog|open', () => '/tmp/pic.png')
    ipc.override('read_file_bytes', () => PNG_B64)

    render(<BlobViewerDialog {...baseProps} onApply={onApply} initialBase64="" />)
    await user.click(screen.getByTestId('blob-load-file'))
    await waitFor(() => expect(screen.getByTestId('blob-image')).toBeInTheDocument())
    await user.click(screen.getByTestId('blob-apply'))

    const envelope = onApply.mock.calls[0][0] as BlobEnvelope
    expect(envelope.kind).toBe('bytes')
    expect(envelope.base64).toBe(PNG_B64)
  })

  it('Save to file seeds the detected extension and writes bytes', async () => {
    const user = userEvent.setup()
    const saveOptions: Array<{ defaultPath?: string }> = []
    ipc.override('plugin:dialog|save', (args) => {
      saveOptions.push((args as { options: { defaultPath?: string } }).options)
      return '/tmp/out.png'
    })
    const writeCalls: unknown[] = []
    ipc.override('write_file_bytes', (args) => {
      writeCalls.push(args)
      return null
    })

    render(<BlobViewerDialog {...baseProps} mode="view" initialBase64={PNG_B64} />)
    await user.click(await screen.findByTestId('blob-save-file'))

    await waitFor(() => expect(saveOptions).toHaveLength(1))
    expect(saveOptions[0]).toMatchObject({ defaultPath: 'photo.png' })
    await waitFor(() => expect(writeCalls).toHaveLength(1))
    expect(writeCalls[0]).toMatchObject({ path: '/tmp/out.png', base64: PNG_B64 })
  })

  it('view mode hides edit controls and shows only Close', async () => {
    render(<BlobViewerDialog {...baseProps} mode="view" initialBase64={PNG_B64} />)
    await screen.findByTestId('blob-image')

    expect(screen.queryByTestId('blob-action-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('blob-set-null')).not.toBeInTheDocument()
    expect(screen.queryByTestId('blob-apply')).not.toBeInTheDocument()
    expect(screen.queryByTestId('blob-cancel')).not.toBeInTheDocument()
    // View mode: header close + footer Close, no edit toolbar.
    expect(screen.getByTestId('blob-close')).toBeInTheDocument()
    expect(screen.getByTestId('blob-close')).toHaveAttribute('title', 'Close')
    expect(screen.getByTestId('blob-close-footer')).toBeInTheDocument()
    // Save-to-file remains for inlined query-result bytes (lives in the header).
    expect(screen.getByTestId('blob-save-file')).toBeEnabled()
  })

  it('renders separated acquire/export and destructive toolbar groups in edit mode', async () => {
    render(<BlobViewerDialog {...baseProps} initialBase64={TEXT_B64} />)
    await screen.findByTestId('blob-action-bar')

    // Acquire/export group.
    expect(screen.getByTestId('blob-load-file')).toHaveTextContent('Load file')
    expect(screen.getByTestId('blob-paste-toggle')).toHaveTextContent('Paste')
    expect(screen.getByTestId('blob-save-file')).toHaveTextContent('Save to file')
    // Destructive group: text-labelled, with tooltips.
    const setNull = screen.getByTestId('blob-set-null')
    const clear = screen.getByTestId('blob-clear')
    expect(setNull).toHaveTextContent('Set NULL')
    expect(setNull).toHaveAttribute('title')
    expect(clear).toHaveTextContent('Clear')
    expect(clear).toHaveAttribute('title')
  })

  it('shows a loading skeleton while the loader is pending', async () => {
    let resolve: ((r: BlobValueResponse) => void) | undefined
    const loader = vi.fn(
      () =>
        new Promise<BlobValueResponse>((r) => {
          resolve = r
        })
    )
    render(<BlobViewerDialog {...baseProps} loader={loader} />)
    expect(await screen.findByTestId('blob-loading')).toBeInTheDocument()
    resolve?.(bytesResponse(TEXT_B64, TEXT_BYTES.length))
    await waitFor(() => expect(screen.queryByTestId('blob-loading')).not.toBeInTheDocument())
  })

  it('exposes tab roles and tabpanel wiring', async () => {
    render(<BlobViewerDialog {...baseProps} mode="view" initialBase64={TEXT_B64} />)
    await screen.findByTestId('blob-not-image')

    const tablist = screen.getByRole('tablist')
    expect(tablist).toBeInTheDocument()
    const imageTab = screen.getByTestId('blob-tab-image')
    expect(imageTab).toHaveAttribute('role', 'tab')
    expect(imageTab).toHaveAttribute('aria-selected', 'true')
    expect(imageTab).toHaveAttribute('aria-controls', 'blob-panel-image')
    expect(screen.getByTestId('blob-panel')).toHaveAttribute('aria-labelledby', 'blob-tab-image')
  })

  it('surfaces a toast when paste input is malformed', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<BlobViewerDialog {...baseProps} onApply={onApply} initialBase64="" />)

    await user.click(screen.getByTestId('blob-paste-toggle'))
    await user.type(screen.getByTestId('blob-paste-input'), '!!! not valid @@@')
    await user.click(screen.getByTestId('blob-paste-apply'))

    await expectToast('error', 'parse')
    expect(onApply).not.toHaveBeenCalled()
  })

  // -- Loader rejection / decode failure ------------------------------------

  it('falls back to empty state and toasts when the loader rejects', async () => {
    const loader = vi.fn(async (): Promise<BlobValueResponse> => {
      throw new Error('boom')
    })
    render(<BlobViewerDialog {...baseProps} loader={loader} />)

    expect(await screen.findByTestId('blob-empty-state')).toBeInTheDocument()
    await expectToast('error', 'load')
  })

  it('falls back to empty state and toasts when initialBase64 cannot be decoded', async () => {
    render(<BlobViewerDialog {...baseProps} mode="view" initialBase64="@@@invalid@@@" />)

    await expectToast('error', 'decode')
    expect(await screen.findByTestId('blob-empty-state')).toBeInTheDocument()
  })

  // -- Load from file edge cases --------------------------------------------

  it('does nothing when the load-from-file picker is cancelled', async () => {
    const user = userEvent.setup()
    let openCalled = false
    ipc.override('plugin:dialog|open', () => {
      openCalled = true
      return null
    })
    let readCalled = false
    ipc.override('read_file_bytes', () => {
      readCalled = true
      return PNG_B64
    })

    render(<BlobViewerDialog {...baseProps} initialBase64="" />)
    await user.click(screen.getByTestId('blob-load-file'))

    await waitFor(() => expect(openCalled).toBe(true))
    expect(readCalled).toBe(false)
    expect(screen.getByTestId('blob-empty-state')).toBeInTheDocument()
  })

  it('rejects a loaded file that exceeds the 10 MB cap', async () => {
    const user = userEvent.setup()
    ipc.override('plugin:dialog|open', () => '/tmp/big.bin')
    const overCap = bytesToBase64(new Uint8Array(10 * 1024 * 1024 + 1))
    ipc.override('read_file_bytes', () => overCap)

    render(<BlobViewerDialog {...baseProps} initialBase64="" />)
    await user.click(screen.getByTestId('blob-load-file'))

    await expectToast('error', 'too large')
    await waitFor(() => expect(screen.getByTestId('blob-empty-state')).toBeInTheDocument())
  })

  it('toasts when reading the loaded file fails', async () => {
    const user = userEvent.setup()
    ipc.override('plugin:dialog|open', () => '/tmp/x')
    ipc.override('read_file_bytes', () => {
      throw new Error('io fail')
    })

    render(<BlobViewerDialog {...baseProps} initialBase64="" />)
    await user.click(screen.getByTestId('blob-load-file'))

    await expectToast('error', 'io fail')
  })

  // -- Apply tooLarge branch -------------------------------------------------

  it('closes without applying when the working value is tooLarge', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onApply = vi.fn()
    const loader = vi.fn(
      async (): Promise<BlobValueResponse> => ({
        base64: null,
        byteLength: 12 * 1024 * 1024,
        tooLarge: true,
      })
    )
    render(<BlobViewerDialog {...baseProps} onClose={onClose} onApply={onApply} loader={loader} />)

    await screen.findByTestId('blob-too-large-content')
    await user.click(screen.getByTestId('blob-apply'))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onApply).not.toHaveBeenCalled()
  })

  // -- Save to file edge cases ----------------------------------------------

  it('does nothing when the save-to-file picker is cancelled', async () => {
    const user = userEvent.setup()
    let saveCalled = false
    ipc.override('plugin:dialog|save', () => {
      saveCalled = true
      return null
    })
    let writeCalled = false
    ipc.override('write_file_bytes', () => {
      writeCalled = true
      return null
    })

    render(<BlobViewerDialog {...baseProps} mode="view" initialBase64={PNG_B64} />)
    await user.click(await screen.findByTestId('blob-save-file'))

    await waitFor(() => expect(saveCalled).toBe(true))
    expect(writeCalled).toBe(false)
  })

  it('toasts when writing the saved file fails', async () => {
    const user = userEvent.setup()
    ipc.override('plugin:dialog|save', () => '/tmp/out')
    ipc.override('write_file_bytes', () => {
      throw new Error('disk full')
    })

    render(<BlobViewerDialog {...baseProps} mode="view" initialBase64={PNG_B64} />)
    await user.click(await screen.findByTestId('blob-save-file'))

    await expectToast('error', 'disk full')
  })

  // -- Drag and drop ---------------------------------------------------------

  function makeFile(name: string, bytes: Uint8Array): File {
    const file = new File([bytes.slice().buffer], name)
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => bytes.slice().buffer,
    })
    return file
  }

  it('accepts a dropped file and applies its bytes', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<BlobViewerDialog {...baseProps} onApply={onApply} initialBase64="" />)

    const root = screen.getByTestId('blob-viewer-root')
    const file = makeFile('x.png', PNG_BYTES)

    fireEvent.dragEnter(root, { dataTransfer: { files: [file] } })
    fireEvent.dragOver(root, { dataTransfer: { files: [file] } })
    fireEvent.drop(root, { dataTransfer: { files: [file] } })

    expect(await screen.findByTestId('blob-image')).toBeInTheDocument()
    await user.click(screen.getByTestId('blob-apply'))

    const envelope = onApply.mock.calls[0][0] as BlobEnvelope
    expect(envelope.kind).toBe('bytes')
    expect(envelope.base64).toBe(PNG_B64)
  })

  it('rejects a dropped file over the 10 MB cap', async () => {
    render(<BlobViewerDialog {...baseProps} initialBase64="" />)
    const root = screen.getByTestId('blob-viewer-root')
    const file = makeFile('big.bin', new Uint8Array(10 * 1024 * 1024 + 1))

    fireEvent.drop(root, { dataTransfer: { files: [file] } })

    await expectToast('error', 'too large')
    await waitFor(() => expect(screen.getByTestId('blob-empty-state')).toBeInTheDocument())
  })

  it('toasts when a dropped file cannot be read', async () => {
    render(<BlobViewerDialog {...baseProps} initialBase64="" />)
    const root = screen.getByTestId('blob-viewer-root')
    const file = new File([new Uint8Array([1])], 'bad.bin')
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => {
        throw new Error('read fail')
      },
    })

    fireEvent.drop(root, { dataTransfer: { files: [file] } })

    await expectToast('error', 'read fail')
  })

  it('clears the drag overlay across nested drag enter/leave events', async () => {
    render(<BlobViewerDialog {...baseProps} initialBase64="" />)
    const root = screen.getByTestId('blob-viewer-root')

    fireEvent.dragEnter(root)
    fireEvent.dragEnter(root)
    expect(await screen.findByTestId('blob-drop-overlay')).toBeInTheDocument()

    // First leave decrements but stays dragging.
    fireEvent.dragLeave(root)
    expect(screen.getByTestId('blob-drop-overlay')).toBeInTheDocument()

    // Second leave clears the overlay.
    fireEvent.dragLeave(root)
    await waitFor(() => expect(screen.queryByTestId('blob-drop-overlay')).not.toBeInTheDocument())
  })

  // -- ESC / close during drag ----------------------------------------------

  it('first close cancels the drag overlay, second close invokes onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<BlobViewerDialog {...baseProps} onClose={onClose} initialBase64="" />)

    const root = screen.getByTestId('blob-viewer-root')
    fireEvent.dragEnter(root)
    expect(await screen.findByTestId('blob-drop-overlay')).toBeInTheDocument()

    // First close only cancels the drag.
    await user.click(screen.getByTestId('blob-close'))
    expect(onClose).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId('blob-drop-overlay')).not.toBeInTheDocument())

    // Second close propagates.
    await user.click(screen.getByTestId('blob-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // -- Tab keyboard navigation ----------------------------------------------

  it('cycles tabs with arrow keys (wrapping both directions)', async () => {
    render(<BlobViewerDialog {...baseProps} mode="view" initialBase64={TEXT_B64} />)
    const imageTab = await screen.findByTestId('blob-tab-image')

    fireEvent.keyDown(imageTab, { key: 'ArrowRight' })
    expect(screen.getByTestId('blob-tab-text')).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(screen.getByTestId('blob-tab-text'), { key: 'ArrowRight' })
    expect(screen.getByTestId('blob-tab-hex')).toHaveAttribute('aria-selected', 'true')

    // Wrap forward from last back to first.
    fireEvent.keyDown(screen.getByTestId('blob-tab-hex'), { key: 'ArrowRight' })
    expect(screen.getByTestId('blob-tab-image')).toHaveAttribute('aria-selected', 'true')

    // Wrap backward from first to last.
    fireEvent.keyDown(screen.getByTestId('blob-tab-image'), { key: 'ArrowLeft' })
    expect(screen.getByTestId('blob-tab-hex')).toHaveAttribute('aria-selected', 'true')
  })
})
