import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GlobalContextMenu } from '../../../components/common/GlobalContextMenu'

describe('GlobalContextMenu', () => {
  beforeEach(() => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const readText = vi.fn().mockResolvedValue('pasted')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, readText },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prevents default browser context menu on non-editable surfaces', () => {
    render(
      <>
        <GlobalContextMenu />
        <div data-testid="surface">x</div>
      </>
    )

    const surface = screen.getByTestId('surface')
    const spy = vi.fn((e: Event) => {
      expect(e.defaultPrevented).toBe(true)
    })
    surface.addEventListener('contextmenu', spy)

    fireEvent.contextMenu(surface, { clientX: 12, clientY: 34, bubbles: true })

    expect(spy).toHaveBeenCalled()
    expect(screen.queryByTestId('global-context-menu')).not.toBeInTheDocument()
  })

  it('opens Cut/Copy/Paste menu on text input right-click and stops propagation', () => {
    const onParentMenu = vi.fn()

    render(
      <div onContextMenu={onParentMenu}>
        <GlobalContextMenu />
        <input data-testid="field" defaultValue="hello" />
      </div>
    )

    fireEvent.contextMenu(screen.getByTestId('field'), { clientX: 50, clientY: 60, bubbles: true })

    expect(onParentMenu).not.toHaveBeenCalled()
    const menu = screen.getByTestId('global-context-menu')
    expect(menu).toBeInTheDocument()
    expect(screen.getByTestId('global-context-cut')).toBeInTheDocument()
    expect(screen.getByTestId('global-context-copy')).toBeInTheDocument()
    expect(screen.getByTestId('global-context-paste')).toBeInTheDocument()
  })

  it('dismisses on Escape', () => {
    render(
      <>
        <GlobalContextMenu />
        <input data-testid="field" defaultValue="a" />
      </>
    )

    fireEvent.contextMenu(screen.getByTestId('field'), { clientX: 1, clientY: 2 })
    expect(screen.getByTestId('global-context-menu')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('global-context-menu')).not.toBeInTheDocument()
  })

  it('dismisses on outside mousedown', () => {
    render(
      <>
        <GlobalContextMenu />
        <input data-testid="field" defaultValue="a" />
        <div data-testid="outside">out</div>
      </>
    )

    fireEvent.contextMenu(screen.getByTestId('field'), { clientX: 1, clientY: 2 })
    expect(screen.getByTestId('global-context-menu')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryByTestId('global-context-menu')).not.toBeInTheDocument()
  })

  it('clamps menu position to the viewport', () => {
    const innerWidth = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(320)
    const innerHeight = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(240)

    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.getAttribute('data-testid') === 'global-context-menu') {
        return { width: 280, height: 40, top: 0, left: 0, right: 280, bottom: 40, x: 0, y: 0 } as DOMRect
      }
      return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 } as DOMRect
    })

    render(
      <>
        <GlobalContextMenu />
        <input data-testid="field" defaultValue="a" />
      </>
    )

    fireEvent.contextMenu(screen.getByTestId('field'), { clientX: 300, clientY: 200 })

    const menu = screen.getByTestId('global-context-menu')
    expect(menu).toHaveStyle({ left: '36px', top: '196px' })

    rectSpy.mockRestore()
    innerWidth.mockRestore()
    innerHeight.mockRestore()
  })

  it('copies selected text from an input', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, readText: vi.fn().mockResolvedValue('') },
    })

    render(
      <>
        <GlobalContextMenu />
        <input data-testid="field" defaultValue="hello world" />
      </>
    )

    const input = screen.getByTestId('field') as HTMLInputElement
    input.setSelectionRange(0, 5)

    fireEvent.contextMenu(input, { clientX: 1, clientY: 2 })
    await user.click(screen.getByTestId('global-context-copy'))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('hello')
    })
  })

  it('stops propagation for disabled inputs without opening the menu', () => {
    const onParent = vi.fn()
    render(
      <div onContextMenu={onParent}>
        <GlobalContextMenu />
        <input data-testid="field" disabled defaultValue="x" />
      </div>
    )

    fireEvent.contextMenu(screen.getByTestId('field'), { clientX: 1, clientY: 2, bubbles: true })

    expect(onParent).not.toHaveBeenCalled()
    expect(screen.queryByTestId('global-context-menu')).not.toBeInTheDocument()
  })

  it('cuts selected text from an input', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, readText: vi.fn().mockResolvedValue('') },
    })

    render(
      <>
        <GlobalContextMenu />
        <input data-testid="field" defaultValue="hello world" />
      </>
    )

    const input = screen.getByTestId('field') as HTMLInputElement
    input.setSelectionRange(0, 5)

    fireEvent.contextMenu(input, { clientX: 1, clientY: 2 })
    await user.click(screen.getByTestId('global-context-cut'))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('hello')
      expect(input.value).toBe(' world')
    })
  })

  it('pastes into an input at the selection snapshot', async () => {
    const user = userEvent.setup()
    const readText = vi.fn().mockResolvedValue('NEW')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(), readText },
    })

    render(
      <>
        <GlobalContextMenu />
        <input data-testid="field" defaultValue="hello" />
      </>
    )

    const input = screen.getByTestId('field') as HTMLInputElement
    input.setSelectionRange(2, 2)

    fireEvent.contextMenu(input, { clientX: 1, clientY: 2 })
    await user.click(screen.getByTestId('global-context-paste'))

    await waitFor(() => {
      expect(input.value).toBe('heNEWllo')
    })
  })

  it('disables cut and paste for read-only inputs', () => {
    render(
      <>
        <GlobalContextMenu />
        <input data-testid="field" readOnly defaultValue="abc" />
      </>
    )

    const input = screen.getByTestId('field') as HTMLInputElement
    input.setSelectionRange(0, 1)

    fireEvent.contextMenu(input, { clientX: 1, clientY: 2 })

    expect(screen.getByTestId('global-context-cut')).toBeDisabled()
    expect(screen.getByTestId('global-context-paste')).toBeDisabled()
    expect(screen.getByTestId('global-context-copy')).not.toBeDisabled()
  })

  it('copies from a textarea', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, readText: vi.fn().mockResolvedValue('') },
    })

    render(
      <>
        <GlobalContextMenu />
        <textarea data-testid="field" defaultValue="line one" />
      </>
    )

    const ta = screen.getByTestId('field') as HTMLTextAreaElement
    ta.setSelectionRange(0, 4)

    fireEvent.contextMenu(ta, { clientX: 1, clientY: 2 })
    await user.click(screen.getByTestId('global-context-copy'))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('line')
    })
  })

  it('enables cut and copy when contenteditable has a selection', () => {
    render(
      <>
        <GlobalContextMenu />
        <div data-testid="ce" contentEditable="true">
          hello world
        </div>
      </>
    )

    const ce = screen.getByTestId('ce')
    const textNode = ce.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 5)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    fireEvent.contextMenu(ce, { clientX: 1, clientY: 2 })

    expect(screen.getByTestId('global-context-cut')).not.toBeDisabled()
    expect(screen.getByTestId('global-context-copy')).not.toBeDisabled()
    expect(screen.getByTestId('global-context-paste')).not.toBeDisabled()
  })

  it('invokes execCommand for cut on contenteditable', async () => {
    const user = userEvent.setup()
    const execSpy = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execSpy,
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(), readText: vi.fn().mockResolvedValue('') },
    })

    render(
      <>
        <GlobalContextMenu />
        <div data-testid="ce" contentEditable="true">
          hello
        </div>
      </>
    )

    const ce = screen.getByTestId('ce')
    const textNode = ce.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 2)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    fireEvent.contextMenu(ce, { clientX: 1, clientY: 2 })
    await user.click(screen.getByTestId('global-context-cut'))

    await waitFor(() => {
      expect(execSpy).toHaveBeenCalledWith('cut')
    })
  })

  it('invokes execCommand for copy on contenteditable', async () => {
    const user = userEvent.setup()
    const execSpy = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execSpy,
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(), readText: vi.fn().mockResolvedValue('') },
    })

    render(
      <>
        <GlobalContextMenu />
        <div data-testid="ce" contentEditable="true">
          hello
        </div>
      </>
    )

    const ce = screen.getByTestId('ce')
    const textNode = ce.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 1)
    range.setEnd(textNode, 4)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    fireEvent.contextMenu(ce, { clientX: 1, clientY: 2 })
    await user.click(screen.getByTestId('global-context-copy'))

    await waitFor(() => {
      expect(execSpy).toHaveBeenCalledWith('copy')
    })
  })

  it('pastes into contenteditable when execCommand paste fails', async () => {
    const user = userEvent.setup()
    const readText = vi.fn().mockResolvedValue('INS')
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(), readText },
    })

    render(
      <>
        <GlobalContextMenu />
        <div data-testid="ce" contentEditable="true">
          ab
        </div>
      </>
    )

    const ce = screen.getByTestId('ce')
    const textNode = ce.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 1)
    range.setEnd(textNode, 1)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)

    fireEvent.contextMenu(ce, { clientX: 1, clientY: 2 })
    await user.click(screen.getByTestId('global-context-paste'))

    await waitFor(() => {
      // Fallback inserts relative to the current range; exact sibling order can vary by DOM.
      expect(ce.textContent).toContain('INS')
      expect(ce.textContent).toContain('a')
      expect(ce.textContent).toContain('b')
    })
  })

  it('closes the menu when copy throws', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard failed'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, readText: vi.fn().mockResolvedValue('') },
    })

    render(
      <>
        <GlobalContextMenu />
        <input data-testid="field" defaultValue="hello world" />
      </>
    )

    const input = screen.getByTestId('field') as HTMLInputElement
    input.setSelectionRange(0, 5)

    fireEvent.contextMenu(input, { clientX: 1, clientY: 2 })
    await user.click(screen.getByTestId('global-context-copy'))

    await waitFor(() => {
      expect(screen.queryByTestId('global-context-menu')).not.toBeInTheDocument()
    })
  })

  it('prevents default on menu mousedown to avoid stealing focus', () => {
    render(
      <>
        <GlobalContextMenu />
        <input data-testid="field" defaultValue="a" />
      </>
    )

    fireEvent.contextMenu(screen.getByTestId('field'), { clientX: 1, clientY: 2 })
    const menu = screen.getByTestId('global-context-menu')

    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    const preventSpy = vi.spyOn(ev, 'preventDefault')
    menu.dispatchEvent(ev)
    expect(preventSpy).toHaveBeenCalled()
  })

  it('portals the text context menu into an open dialog (top layer)', () => {
    render(
      <>
        <dialog open data-testid="modal-dlg">
          <input data-testid="field" defaultValue="test" />
        </dialog>
        <GlobalContextMenu />
      </>
    )

    fireEvent.contextMenu(screen.getByTestId('field'), { clientX: 100, clientY: 120 })

    const menu = screen.getByTestId('global-context-menu')
    expect(screen.getByTestId('modal-dlg').contains(menu)).toBe(true)
  })

  it('uses dialog-local coordinates when the field is inside a transformed dialog', () => {
    render(
      <>
        <dialog open data-testid="modal-dlg">
          <input data-testid="field" defaultValue="x" />
        </dialog>
        <GlobalContextMenu />
      </>
    )

    const dlg = screen.getByTestId('modal-dlg')
    vi.spyOn(dlg, 'getBoundingClientRect').mockReturnValue({
      x: 50,
      y: 40,
      width: 800,
      height: 600,
      top: 40,
      left: 50,
      right: 850,
      bottom: 640,
      toJSON: () => '',
    } as DOMRect)

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('data-testid') === 'global-context-menu') {
        return { width: 160, height: 48, top: 0, left: 0, right: 160, bottom: 48, x: 0, y: 0 } as DOMRect
      }
      return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 } as DOMRect
    })

    fireEvent.contextMenu(screen.getByTestId('field'), { clientX: 300, clientY: 220 })

    const menu = screen.getByTestId('global-context-menu')
    expect(menu).toHaveStyle({ left: '250px', top: '180px' })

    vi.restoreAllMocks()
  })

  it('portals to document.body when the input is only inside a CSS-transform wrapper', () => {
    render(
      <>
        <GlobalContextMenu />
        <div style={{ transform: 'translate(40px, 20px)' }}>
          <input data-testid="field" defaultValue="x" />
        </div>
      </>
    )

    fireEvent.contextMenu(screen.getByTestId('field'), { clientX: 200, clientY: 100 })

    expect(screen.getByTestId('global-context-menu').parentElement).toBe(document.body)
  })
})
