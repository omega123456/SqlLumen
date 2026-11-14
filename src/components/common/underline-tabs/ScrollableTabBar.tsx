import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react'
import { useElementSize } from '../../../hooks/use-element-size'
import { Button } from '../Button'
import { BAR_VARIANT_CLASS, type UnderlineTabBarProps } from './tab-bar-variants'
import styles from '../UnderlineTabs.module.css'

const EDGE_CHIP_ICON_SIZE = 14

interface ViewportBounds {
  left: number
  right: number
  atStart: boolean
  atEnd: boolean
}

const HIDDEN_EDGE_TOLERANCE_PX = 1

function hiddenTabSide(tabRect: DOMRect, bounds: ViewportBounds): 'start' | 'end' | null {
  const isHiddenAtStart = !bounds.atStart && tabRect.left < bounds.left - HIDDEN_EDGE_TOLERANCE_PX
  if (isHiddenAtStart) return 'start'
  const isHiddenAtEnd = !bounds.atEnd && tabRect.right > bounds.right + HIDDEN_EDGE_TOLERANCE_PX
  if (isHiddenAtEnd) return 'end'
  return null
}

const START_CHIP_CLEARANCE = 52

function tabItems(element: Element): Element[] {
  return Array.from(element.children).flatMap((child) =>
    getComputedStyle(child).display === 'contents' ? tabItems(child) : [child]
  )
}

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

function revealTab(tab: Element | undefined) {
  tab?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: scrollBehavior() })
}

function scrollViewportBy(viewport: HTMLElement, delta: number) {
  viewport.scrollBy({ left: delta, behavior: scrollBehavior() })
}

interface TabStripElements {
  viewportRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLDivElement | null>
}

interface HiddenTabCounts {
  start: number
  end: number
}

const NO_HIDDEN_TABS: HiddenTabCounts = { start: 0, end: 0 }

function viewportBounds(viewport: HTMLElement): ViewportBounds {
  const { scrollLeft, scrollWidth, clientWidth } = viewport
  const atStart = scrollLeft <= 1
  const atEnd = scrollLeft + clientWidth >= scrollWidth - 1
  const { left, right } = viewport.getBoundingClientRect()
  return { left: left, right: right, atStart: atStart, atEnd: atEnd }
}

function countHiddenTabs(viewport: HTMLElement, content: HTMLElement): HiddenTabCounts {
  const bounds = viewportBounds(viewport)
  const counts = { start: 0, end: 0 }
  for (const tab of tabItems(content)) {
    const hiddenSide = hiddenTabSide(tab.getBoundingClientRect(), bounds)
    if (hiddenSide === 'start') counts.start++
    if (hiddenSide === 'end') counts.end++
  }
  return counts
}

function useHiddenTabCounts({ viewportRef, contentRef }: TabStripElements) {
  const [hidden, setHidden] = useState<HiddenTabCounts>(NO_HIDDEN_TABS)

  const sync = () => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport) return
    if (!content) return
    const counts = countHiddenTabs(viewport, content)
    setHidden((previous) => {
      const isUnchanged = previous.start === counts.start && previous.end === counts.end
      return isUnchanged ? previous : counts
    })
  }

  useLayoutEffect(sync)
  return { hidden: hidden, sync: sync }
}

function useKeepActiveTabVisible(
  contentRef: RefObject<HTMLDivElement | null>,
  overflowing: boolean
) {
  useLayoutEffect(() => {
    if (!overflowing) return
    contentRef.current
      ?.querySelector('[data-active], [aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [contentRef, overflowing])
}

function useVerticalWheelScrollsHorizontally(viewportRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined
    const onWheel = (event: WheelEvent) => {
      const isMostlyHorizontal = Math.abs(event.deltaY) <= Math.abs(event.deltaX)
      if (isMostlyHorizontal) return
      if (viewport.scrollWidth <= viewport.clientWidth) return
      event.preventDefault()
      viewport.scrollLeft += event.deltaY
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [viewportRef])
}

function scrollToStartTab(viewport: HTMLElement, content: HTMLElement) {
  const { left, right } = viewport.getBoundingClientRect()
  const edge = left + START_CHIP_CLEARANCE
  const hidden = tabItems(content).filter((tab) => tab.getBoundingClientRect().left < edge - 1)
  const target = hidden.filter((tab) => tab.getBoundingClientRect().right < right - 1).pop()
  if (target) {
    revealTab(target)
    return
  }
  const overhanging = hidden.pop()
  if (overhanging) scrollViewportBy(viewport, overhanging.getBoundingClientRect().left - edge)
}

function scrollToEndTab(viewport: HTMLElement, content: HTMLElement) {
  const { left, right } = viewport.getBoundingClientRect()
  const hidden = tabItems(content).filter((tab) => tab.getBoundingClientRect().right > right + 1)
  const target = hidden.find(
    (tab) => tab.getBoundingClientRect().left > left + START_CHIP_CLEARANCE + 1
  )
  if (target) {
    revealTab(target)
    return
  }
  const overhanging = hidden[0]
  if (overhanging) scrollViewportBy(viewport, overhanging.getBoundingClientRect().right - right)
}

function scrollStrip(
  elements: TabStripElements,
  scroll: (viewport: HTMLElement, content: HTMLElement) => void
) {
  const viewport = elements.viewportRef.current
  const content = elements.contentRef.current
  if (!viewport) return
  if (!content) return
  scroll(viewport, content)
}

function StartChip({ hiddenCount, onClick }: { hiddenCount: number; onClick: () => void }) {
  return (
    <div className={styles.edgeZoneStart}>
      <Button
        variant="subtle"
        size="sm"
        className={styles.edgeChip}
        aria-label={`Scroll tabs left, ${hiddenCount} hidden`}
        data-testid="tab-strip-scroll-start"
        onClick={onClick}
      >
        <CaretLeftIcon size={EDGE_CHIP_ICON_SIZE} aria-hidden="true" />
        {hiddenCount}
      </Button>
    </div>
  )
}

function EndChip({ hiddenCount, onClick }: { hiddenCount: number; onClick: () => void }) {
  const hasHiddenTabs = hiddenCount > 0
  return (
    <div className={styles.edgeZoneEnd}>
      <Button
        variant="subtle"
        size="sm"
        className={styles.edgeChip}
        aria-label={
          hasHiddenTabs
            ? `Scroll tabs right, ${hiddenCount} hidden`
            : 'Scroll tabs right, no more tabs'
        }
        data-testid="tab-strip-scroll-end"
        disabled={!hasHiddenTabs}
        onClick={onClick}
      >
        {hasHiddenTabs ? hiddenCount : null}
        <CaretRightIcon size={EDGE_CHIP_ICON_SIZE} aria-hidden="true" />
      </Button>
    </div>
  )
}

export function ScrollableTabBar({
  children,
  className,
  'data-testid': testId,
  prefix,
  suffix,
  variant = 'default',
}: UnderlineTabBarProps) {
  const areaRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const elements: TabStripElements = { viewportRef: viewportRef, contentRef: contentRef }
  const overflowing = useElementSize(contentRef).width > useElementSize(areaRef).width
  const { hidden, sync } = useHiddenTabCounts(elements)
  useKeepActiveTabVisible(contentRef, overflowing)
  useVerticalWheelScrollsHorizontally(viewportRef)

  const wrapperClass = [styles.barWrapper, BAR_VARIANT_CLASS[variant], className]
    .filter(Boolean)
    .join(' ')
  const barClass = [styles.bar, styles.barScrollable, BAR_VARIANT_CLASS[variant]]
    .filter(Boolean)
    .join(' ')
  const hasHiddenStartTabs = overflowing && hidden.start > 0

  return (
    <div className={wrapperClass} data-testid={testId} data-overflowing={overflowing || undefined}>
      {prefix}
      <div ref={areaRef} className={styles.scrollArea}>
        {hasHiddenStartTabs ? (
          <StartChip
            hiddenCount={hidden.start}
            onClick={() => scrollStrip(elements, scrollToStartTab)}
          />
        ) : null}
        <div ref={viewportRef} className={barClass} onScroll={sync}>
          <div ref={contentRef} className={styles.barContent}>
            {children}
          </div>
        </div>
        {overflowing ? (
          <EndChip hiddenCount={hidden.end} onClick={() => scrollStrip(elements, scrollToEndTab)} />
        ) : null}
      </div>
      {suffix ? <div className={styles.barSuffix}>{suffix}</div> : null}
    </div>
  )
}
