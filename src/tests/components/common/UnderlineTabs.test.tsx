import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { dispatchAuxClick } from '../../helpers/dispatch-aux-click'
import userEvent from '@testing-library/user-event'
import { UnderlineTabBar, UnderlineTab } from '../../../components/common/UnderlineTabs'

describe('UnderlineTabs', () => {
  it('renders simple tab and toggles data-active', () => {
    const { rerender } = render(
      <UnderlineTabBar>
        <UnderlineTab data-testid="t1" active={false} onClick={() => {}}>
          One
        </UnderlineTab>
      </UnderlineTabBar>
    )

    const btn = screen.getByTestId('t1')
    expect(btn).not.toHaveAttribute('data-active')
    expect(btn).toHaveTextContent('One')

    rerender(
      <UnderlineTabBar>
        <UnderlineTab data-testid="t1" active onClick={() => {}}>
          One
        </UnderlineTab>
      </UnderlineTabBar>
    )
    expect(screen.getByTestId('t1')).toHaveAttribute('data-active')
  })

  it('renders split tab with suffix and marks active on cell', () => {
    render(
      <UnderlineTabBar>
        <UnderlineTab
          active
          data-testid="cell"
          onSelect={() => {}}
          prefix={<span data-testid="pfx">•</span>}
          suffix={
            <button type="button" aria-label="Close">
              ×
            </button>
          }
        >
          Label
        </UnderlineTab>
      </UnderlineTabBar>
    )

    expect(screen.getByTestId('cell')).toHaveAttribute('data-active')
    expect(screen.getByTestId('pfx')).toBeInTheDocument()
    expect(screen.getByLabelText('Close')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Label/ })).toBeInTheDocument()
  })

  it('applies the selector and document variant classes to bars and tabs', () => {
    render(
      <>
        <UnderlineTabBar data-testid="sel-bar" variant="selector">
          <UnderlineTab data-testid="sel-tab" variant="selector" active onClick={() => {}}>
            Tables
          </UnderlineTab>
        </UnderlineTabBar>
        <UnderlineTabBar data-testid="doc-bar" variant="document" scrollable>
          <UnderlineTab
            data-testid="doc-tab"
            variant="document"
            onSelect={() => {}}
            suffix={<span>x</span>}
          >
            Query 1
          </UnderlineTab>
        </UnderlineTabBar>
        <UnderlineTabBar data-testid="default-bar">
          <UnderlineTab data-testid="default-tab" onClick={() => {}}>
            Columns
          </UnderlineTab>
        </UnderlineTabBar>
      </>
    )

    expect(screen.getByTestId('sel-bar').className).toMatch(/barSelector/)
    expect(screen.getByTestId('sel-tab').className).toMatch(/tabSelector/)
    expect(screen.getByTestId('doc-bar').className).toMatch(/barDocument/)
    expect(screen.getByTestId('doc-tab').className).toMatch(/tabDocument/)
    expect(screen.getByTestId('default-bar').className).not.toMatch(/barSelector|barDocument/)
    expect(screen.getByTestId('default-tab').className).not.toMatch(/tabSelector|tabDocument/)
  })

  it('applies the bar variant class to the suffix wrapper', () => {
    render(
      <UnderlineTabBar data-testid="wrap" variant="document" suffix={<span>+</span>}>
        <UnderlineTab onClick={() => {}}>A</UnderlineTab>
      </UnderlineTabBar>
    )
    expect(screen.getByTestId('wrap').className).toMatch(/barWrapper/)
    expect(screen.getByTestId('wrap').className).toMatch(/barDocument/)
  })

  it('renders a prefix before the tabs and the suffix after them', () => {
    const { rerender } = render(
      <UnderlineTabBar
        data-testid="wrap"
        variant="document"
        prefix={<span data-testid="pre">P</span>}
        suffix={<span data-testid="suf">S</span>}
      >
        <UnderlineTab data-testid="tab" onClick={() => {}}>
          A
        </UnderlineTab>
      </UnderlineTabBar>
    )
    const wrap = screen.getByTestId('wrap')
    const tab = screen.getByTestId('tab')
    expect(wrap.firstElementChild).toBe(screen.getByTestId('pre'))
    expect(screen.getByTestId('pre').compareDocumentPosition(tab)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(tab.compareDocumentPosition(screen.getByTestId('suf'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )

    rerender(
      <UnderlineTabBar data-testid="wrap" prefix={<span data-testid="pre">P</span>}>
        <UnderlineTab data-testid="tab" onClick={() => {}}>
          A
        </UnderlineTab>
      </UnderlineTabBar>
    )
    expect(screen.getByTestId('wrap').className).toMatch(/barWrapper/)
    expect(screen.getByTestId('wrap').firstElementChild).toBe(screen.getByTestId('pre'))
  })

  it('renders a prefix before the scroll area of scrollable bars', () => {
    render(
      <UnderlineTabBar data-testid="wrap" scrollable prefix={<span data-testid="pre">P</span>}>
        <UnderlineTab onClick={() => {}}>A</UnderlineTab>
      </UnderlineTabBar>
    )
    expect(screen.getByTestId('wrap').firstElementChild).toBe(screen.getByTestId('pre'))
  })

  it('marks the selected tab with aria-selected on its focusable control', () => {
    render(
      <UnderlineTabBar>
        <UnderlineTab data-testid="simple-on" active onClick={() => {}}>
          On
        </UnderlineTab>
        <UnderlineTab data-testid="simple-off" onClick={() => {}}>
          Off
        </UnderlineTab>
        <UnderlineTab active onSelect={() => {}} suffix={<span>x</span>}>
          Split on
        </UnderlineTab>
        <UnderlineTab onSelect={() => {}} suffix={<span>x</span>}>
          Split off
        </UnderlineTab>
      </UnderlineTabBar>
    )
    expect(screen.getByTestId('simple-on')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('simple-off')).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('button', { name: 'Split on' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Split off' })).toHaveAttribute(
      'aria-selected',
      'false'
    )
  })

  it('drops the selected document tab outline and the document hover fill', () => {
    const css = readFileSync('src/components/common/UnderlineTabs.module.css', 'utf8')
    const active = css.match(
      /\.tabDocument\.simpleActive,\s*\.tabDocument\.cellActive\s*\{([^}]*)\}/
    )
    expect(active?.[1]).toContain('background-color: var(--surface-container)')
    expect(active?.[1]).not.toContain('border-color')
    expect(css).toMatch(
      /\.tabDocument:hover:not\(\[data-active\]\)\s*\{[^}]*background-color:\s*transparent/
    )
  })

  it('invokes onClick for simple and onSelect for split label', async () => {
    const user = userEvent.setup()
    const onSimple = vi.fn()
    const onSelect = vi.fn()

    render(
      <UnderlineTabBar>
        <UnderlineTab onClick={onSimple}>A</UnderlineTab>
        <UnderlineTab onSelect={onSelect} suffix={<span />}>
          B
        </UnderlineTab>
      </UnderlineTabBar>
    )

    await user.click(screen.getByRole('button', { name: 'A' }))
    expect(onSimple).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'B' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('invokes onSelect via Enter and Space key on split tab label', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <UnderlineTabBar>
        <UnderlineTab onSelect={onSelect} suffix={<span />}>
          Label
        </UnderlineTab>
      </UnderlineTabBar>
    )

    const labelBtn = screen.getByRole('button', { name: 'Label' })
    labelBtn.focus()

    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledTimes(1)

    await user.keyboard('{ }')
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('does not invoke onSelect for non-Enter/Space keys on split tab', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <UnderlineTabBar>
        <UnderlineTab onSelect={onSelect} suffix={<span />}>
          Label
        </UnderlineTab>
      </UnderlineTabBar>
    )

    const labelBtn = screen.getByRole('button', { name: 'Label' })
    labelBtn.focus()

    await user.keyboard('{Tab}')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('invokes onAuxClick for simple and split tab cell', () => {
    const onAuxSimple = vi.fn()
    const onAuxSplit = vi.fn()

    render(
      <UnderlineTabBar>
        <UnderlineTab data-testid="simple" onClick={() => {}} onAuxClick={onAuxSimple}>
          A
        </UnderlineTab>
        <UnderlineTab
          data-testid="split-cell"
          onSelect={() => {}}
          onAuxClick={onAuxSplit}
          suffix={<span />}
        >
          B
        </UnderlineTab>
      </UnderlineTabBar>
    )

    dispatchAuxClick(screen.getByTestId('simple'))
    expect(onAuxSimple).toHaveBeenCalledTimes(1)

    dispatchAuxClick(screen.getByTestId('split-cell'))
    expect(onAuxSplit).toHaveBeenCalledTimes(1)
  })

  it('starts split-tab drag from label surface using outer draggable container', () => {
    const onDragStart = vi.fn()

    render(
      <UnderlineTabBar>
        <UnderlineTab
          data-testid="split-cell"
          onSelect={() => {}}
          onDragStart={onDragStart}
          draggable
          suffix={<span>suffix</span>}
        >
          Drag Label
        </UnderlineTab>
      </UnderlineTabBar>
    )

    fireEvent.dragStart(screen.getByRole('button', { name: 'Drag Label' }))
    expect(onDragStart).toHaveBeenCalledTimes(1)
  })

  it('hides the native scrollbar on scrollable bars', () => {
    const css = readFileSync('src/components/common/UnderlineTabs.module.css', 'utf8')
    expect(css).toMatch(/\.barScrollable\s*\{[^}]*overflow-x:\s*auto/)
    expect(css).toMatch(/\.barScrollable\s*\{[^}]*scrollbar-width:\s*none/)
    expect(css).toMatch(/\.barScrollable::-webkit-scrollbar\s*\{[^}]*display:\s*none/)
    expect(css).not.toContain('scrollbar-gutter')
  })

  describe('scrollable bar', () => {
    const TAB_WIDTH = 150
    const VIEWPORT_WIDTH = 300
    const callbacks = new Map<Element, ResizeObserverCallback>()
    const OriginalResizeObserver = globalThis.ResizeObserver
    let scroll = 0

    beforeEach(() => {
      scroll = 0
      callbacks.clear()
      globalThis.ResizeObserver = class {
        constructor(private callback: ResizeObserverCallback) {}
        observe(element: Element) {
          callbacks.set(element, this.callback)
        }
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
    })

    afterEach(() => {
      globalThis.ResizeObserver = OriginalResizeObserver
      vi.restoreAllMocks()
    })

    const resize = (element: Element, width: number) =>
      act(() => {
        callbacks.get(element)?.(
          [{ contentRect: { width, height: 38 } } as ResizeObserverEntry],
          {} as ResizeObserver
        )
      })

    const rect = (left: number, width: number) =>
      ({ left, right: left + width, width, top: 0, bottom: 32, height: 32 }) as DOMRect

    function renderBar(count: number, wrapTabs = false, widths?: number[]) {
      const tabWidths = widths ?? Array.from({ length: count }, () => TAB_WIDTH)
      const starts = tabWidths.map((_, i) => tabWidths.slice(0, i).reduce((a, b) => a + b, 0))
      const tabs = Array.from({ length: count }, (_, i) => (
        <button key={i} type="button">
          Tab {i + 1}
        </button>
      ))
      render(
        <UnderlineTabBar data-testid="bar" variant="document" scrollable>
          {wrapTabs ? <div style={{ display: 'contents' }}>{tabs}</div> : tabs}
        </UnderlineTabBar>
      )
      const first = screen.getByRole('button', { name: 'Tab 1' })
      const content = wrapTabs ? first.parentElement!.parentElement! : first.parentElement!
      const viewport = content.parentElement!
      const area = viewport.parentElement!
      vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(rect(0, VIEWPORT_WIDTH))
      Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: VIEWPORT_WIDTH })
      Object.defineProperty(viewport, 'scrollWidth', {
        configurable: true,
        value: tabWidths.reduce((a, b) => a + b, 0),
      })
      Array.from({ length: count }, (_, i) =>
        screen.getByRole('button', { name: `Tab ${i + 1}` })
      ).forEach((tab, i) => {
        vi.spyOn(tab, 'getBoundingClientRect').mockImplementation(() =>
          rect(starts[i]! - scroll, tabWidths[i]!)
        )
      })
      return { area, content, viewport }
    }

    function scrollTo(viewport: HTMLElement, left: number) {
      scroll = left
      viewport.scrollLeft = left
      fireEvent.scroll(viewport)
    }

    it('marks the bar as overflowing only while its tabs are wider than the strip', () => {
      const { area, content } = renderBar(1)
      const bar = screen.getByTestId('bar')

      resize(area, 300)
      resize(content, 200)
      expect(bar).not.toHaveAttribute('data-overflowing')
      expect(screen.queryByTestId('tab-strip-scroll-end')).not.toBeInTheDocument()

      resize(content, 400)
      expect(bar).toHaveAttribute('data-overflowing', 'true')

      // Fits the strip again: the end chip's slot must not keep the bar overflowing.
      resize(content, 280)
      expect(bar).not.toHaveAttribute('data-overflowing')
    })

    it('keeps the selected tab in view when the tabs start to overflow', () => {
      render(
        <UnderlineTabBar data-testid="bar" variant="selector" scrollable>
          <button type="button">Result 1</button>
          <button type="button" aria-selected="true">
            Result 2
          </button>
        </UnderlineTabBar>
      )
      const selected = screen.getByRole('button', { name: 'Result 2' })
      const content = selected.parentElement!
      const area = content.parentElement!.parentElement!
      const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')

      resize(area, 300)
      resize(content, 400)
      expect(scrollIntoView.mock.contexts.slice(-1)[0]).toBe(selected)
    })

    it('counts hidden tabs on each side and names the chips', () => {
      const { area, content, viewport } = renderBar(6)
      resize(area, 345)
      resize(content, 900)

      expect(screen.queryByTestId('tab-strip-scroll-start')).not.toBeInTheDocument()
      const end = screen.getByTestId('tab-strip-scroll-end')
      expect(end).toHaveAccessibleName('Scroll tabs right, 4 hidden')
      expect(end).toHaveTextContent('4')
      expect(end).toBeEnabled()

      scrollTo(viewport, 320)
      expect(screen.getByTestId('tab-strip-scroll-start')).toHaveAccessibleName(
        'Scroll tabs left, 3 hidden'
      )
      expect(end).toHaveAccessibleName('Scroll tabs right, 2 hidden')

      scrollTo(viewport, 600)
      expect(end).toHaveAccessibleName('Scroll tabs right, no more tabs')
      expect(end).toBeDisabled()
      expect(end).toHaveTextContent('')
    })

    it('looks through display: contents wrappers when counting tabs', () => {
      const { area, content } = renderBar(4, true)
      resize(area, 345)
      resize(content, 600)
      expect(screen.getByTestId('tab-strip-scroll-end')).toHaveAccessibleName(
        'Scroll tabs right, 2 hidden'
      )
    })

    it('scrolls the next hidden tab into view from each chip', async () => {
      const user = userEvent.setup()
      const { area, content, viewport } = renderBar(6)
      resize(area, 345)
      resize(content, 900)
      scrollTo(viewport, 320)
      const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')

      await user.click(screen.getByTestId('tab-strip-scroll-end'))
      expect(scrollIntoView.mock.contexts.slice(-1)[0]).toBe(
        screen.getByRole('button', { name: 'Tab 5' })
      )
      expect(scrollIntoView).toHaveBeenLastCalledWith({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'smooth',
      })

      // Tab 3 starts at 300 - 320 = -20; tab 4 at 130 is clear of the 52px chip.
      await user.click(screen.getByTestId('tab-strip-scroll-start'))
      expect(scrollIntoView.mock.contexts.slice(-1)[0]).toBe(
        screen.getByRole('button', { name: 'Tab 3' })
      )
    })

    it('skips a tab wider than the strip so the chips keep scrolling', async () => {
      const user = userEvent.setup()
      const { area, content, viewport } = renderBar(6, false, [150, 150, 150, 500, 150, 150])
      resize(area, 345)
      resize(content, 1250)
      // Tab 4 (450–950) sits at the start chip's edge and overhangs the strip's end.
      scrollTo(viewport, 398)
      const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')

      await user.click(screen.getByTestId('tab-strip-scroll-end'))
      expect(scrollIntoView.mock.contexts.slice(-1)[0]).toBe(
        screen.getByRole('button', { name: 'Tab 5' })
      )

      await user.click(screen.getByTestId('tab-strip-scroll-start'))
      expect(scrollIntoView.mock.contexts.slice(-1)[0]).toBe(
        screen.getByRole('button', { name: 'Tab 3' })
      )
    })

    it('scrolls by the hidden part of an overhanging tab when no other tab follows', async () => {
      const user = userEvent.setup()
      const { area, content, viewport } = renderBar(2, false, [150, 600])
      resize(area, 345)
      resize(content, 750)
      const scrollBy = vi.fn()
      viewport.scrollBy = scrollBy
      // Tab 2 (150–750) runs from behind the start chip past the strip's end.
      scrollTo(viewport, 130)
      const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')

      await user.click(screen.getByTestId('tab-strip-scroll-end'))
      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(scrollBy).toHaveBeenLastCalledWith({ left: 320, behavior: 'smooth' })

      // Tab 1 ends inside the strip, so the start chip reveals it.
      await user.click(screen.getByTestId('tab-strip-scroll-start'))
      expect(scrollIntoView.mock.contexts.slice(-1)[0]).toBe(
        screen.getByRole('button', { name: 'Tab 1' })
      )
    })

    it('scrolls back by the hidden start of an overhanging first tab', async () => {
      const user = userEvent.setup()
      const { area, content, viewport } = renderBar(2, false, [600, 150])
      resize(area, 345)
      resize(content, 750)
      const scrollBy = vi.fn()
      viewport.scrollBy = scrollBy
      // Tab 1 (0–600) runs from behind the start chip past the strip's end.
      scrollTo(viewport, 100)
      const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')

      await user.click(screen.getByTestId('tab-strip-scroll-start'))
      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(scrollBy).toHaveBeenLastCalledWith({ left: -152, behavior: 'smooth' })

      await user.click(screen.getByTestId('tab-strip-scroll-end'))
      expect(scrollIntoView.mock.contexts.slice(-1)[0]).toBe(
        screen.getByRole('button', { name: 'Tab 2' })
      )
    })

    it('scrolls without animation when reduced motion is preferred', async () => {
      const user = userEvent.setup()
      vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
      const { area, content } = renderBar(6)
      resize(area, 345)
      resize(content, 900)
      const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')

      await user.click(screen.getByTestId('tab-strip-scroll-end'))
      expect(scrollIntoView).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'auto' }))
    })

    it('turns a vertical wheel into horizontal scrolling only while the tabs overflow', () => {
      const { viewport } = renderBar(2)
      Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 300 })
      Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: 300 })

      fireEvent.wheel(viewport, { deltaY: 40 })
      expect(viewport.scrollLeft).toBe(0)

      Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: 900 })
      fireEvent.wheel(viewport, { deltaX: 50, deltaY: 10 })
      expect(viewport.scrollLeft).toBe(0)

      const notPrevented = fireEvent.wheel(viewport, { deltaY: 40 })
      expect(viewport.scrollLeft).toBe(40)
      expect(notPrevented).toBe(false)
    })
  })
})
