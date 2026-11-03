import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react'
import { useElementSize } from '../../hooks/use-element-size'
import { Button } from './Button'
import styles from './UnderlineTabs.module.css'

/**
 * - default: WinUI SelectorBar — centred 16×3 accent pill (dialog and view tabs)
 * - selector: tab-group row — semibold text, accent icon and a 2px accent underline
 * - document: rounded 32px document tabs in a 38px strip; the selected tab joins the content below
 */
export type UnderlineTabVariant = 'default' | 'selector' | 'document'

const BAR_VARIANT_CLASS: Record<UnderlineTabVariant, string> = {
  default: '',
  selector: styles.barSelector,
  document: styles.barDocument,
}

const TAB_VARIANT_CLASS: Record<UnderlineTabVariant, string> = {
  default: '',
  selector: styles.tabSelector,
  document: styles.tabDocument,
}

export interface UnderlineTabBarProps {
  children: ReactNode
  className?: string
  'data-testid'?: string
  /** Content rendered before the tab area, outside its scroll box (e.g. a group picker). */
  prefix?: ReactNode
  /** Content rendered outside the scrollable tab area (e.g. pinned tabs, action buttons). */
  suffix?: ReactNode
  /** When true, tabs scroll horizontally with a hidden scrollbar. While they overflow
   * (`data-overflowing`), count chips at each end show and scroll to the hidden tabs. */
  scrollable?: boolean
  variant?: UnderlineTabVariant
}

export function UnderlineTabBar(props: UnderlineTabBarProps) {
  if (props.scrollable) {
    return <ScrollableTabBar {...props} />
  }
  const { children, className, 'data-testid': testId, prefix, suffix, variant = 'default' } = props
  const barClass = [styles.bar, BAR_VARIANT_CLASS[variant]].filter(Boolean).join(' ')
  if (prefix || suffix) {
    const wrapperClass = [styles.barWrapper, BAR_VARIANT_CLASS[variant], className]
      .filter(Boolean)
      .join(' ')
    return (
      <div className={wrapperClass} data-testid={testId}>
        {prefix}
        <div className={barClass}>{children}</div>
        {suffix ? <div className={styles.barSuffix}>{suffix}</div> : null}
      </div>
    )
  }
  const finalBarClass = className ? `${barClass} ${className}` : barClass
  return (
    <div className={finalBarClass} data-testid={testId}>
      {children}
    </div>
  )
}

/** Width the start chip covers; matches `scroll-padding-inline-start` in the CSS. */
const START_CHIP_CLEARANCE = 52

/** Laid-out tabs of the row, looking through `display: contents` wrappers. */
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

function ScrollableTabBar({
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
  // Compare against the whole area, not the viewport the end chip narrows, so the chips
  // go away as soon as every tab fits again.
  const overflowing = useElementSize(contentRef).width > useElementSize(areaRef).width
  const [[hiddenStart, hiddenEnd], setHidden] = useState<[number, number]>([0, 0])

  const sync = () => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
    // At either scroll extreme nothing more is hidden on that side, even when a fractional
    // viewport width leaves the last tab a sub-pixel short.
    const { scrollLeft, scrollWidth, clientWidth } = viewport
    const atStart = scrollLeft <= 1
    const atEnd = scrollLeft + clientWidth >= scrollWidth - 1
    const { left, right } = viewport.getBoundingClientRect()
    let start = 0
    let end = 0
    for (const tab of tabItems(content)) {
      const rect = tab.getBoundingClientRect()
      if (!atStart && rect.left < left - 1) start++
      else if (!atEnd && rect.right > right + 1) end++
    }
    setHidden((prev) => (prev[0] === start && prev[1] === end ? prev : [start, end]))
  }

  useLayoutEffect(sync)

  // The end chip's slot narrows the viewport as overflow starts; keep the selected tab in view.
  useLayoutEffect(() => {
    if (!overflowing) return
    contentRef.current
      ?.querySelector('[data-active], [aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [overflowing])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      if (viewport.scrollWidth <= viewport.clientWidth) return
      e.preventDefault()
      viewport.scrollLeft += e.deltaY
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [])

  // scrollIntoView('nearest') leaves a tab where it is when it is wider than the visible strip and
  // already lines up with, or overhangs, the edge it would align to. The chips skip such a tab to
  // the next one, or scroll by its hidden part when it is the last one on that side.
  const scrollToStart = () => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
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

  const scrollToEnd = () => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return
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

  const wrapperClass = [styles.barWrapper, BAR_VARIANT_CLASS[variant], className]
    .filter(Boolean)
    .join(' ')
  const barClass = [styles.bar, styles.barScrollable, BAR_VARIANT_CLASS[variant]]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={wrapperClass} data-testid={testId} data-overflowing={overflowing || undefined}>
      {prefix}
      <div ref={areaRef} className={styles.scrollArea}>
        {overflowing && hiddenStart > 0 ? (
          <div className={styles.edgeZoneStart}>
            <Button
              variant="subtle"
              size="sm"
              className={styles.edgeChip}
              aria-label={`Scroll tabs left, ${hiddenStart} hidden`}
              data-testid="tab-strip-scroll-start"
              onClick={scrollToStart}
            >
              <CaretLeftIcon size={14} aria-hidden="true" />
              {hiddenStart}
            </Button>
          </div>
        ) : null}
        <div ref={viewportRef} className={barClass} onScroll={sync}>
          <div ref={contentRef} className={styles.barContent}>
            {children}
          </div>
        </div>
        {overflowing ? (
          <div className={styles.edgeZoneEnd}>
            <Button
              variant="subtle"
              size="sm"
              className={styles.edgeChip}
              aria-label={
                hiddenEnd > 0
                  ? `Scroll tabs right, ${hiddenEnd} hidden`
                  : 'Scroll tabs right, no more tabs'
              }
              data-testid="tab-strip-scroll-end"
              disabled={hiddenEnd === 0}
              onClick={scrollToEnd}
            >
              {hiddenEnd > 0 ? hiddenEnd : null}
              <CaretRightIcon size={14} aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>
      {suffix ? <div className={styles.barSuffix}>{suffix}</div> : null}
    </div>
  )
}

export interface UnderlineTabProps {
  active?: boolean
  children: ReactNode
  className?: string
  'data-testid'?: string
  'aria-label'?: string
  title?: string
  autoScrollOnActive?: boolean
  /** Simple tab: one button, use onClick. */
  onClick?: () => void
  /** Split tab: main label action. */
  onSelect?: () => void
  /** Middle-click (auxiliary button); use e.preventDefault() in the handler to suppress browser autoscroll. */
  onAuxClick?: (e: MouseEvent<HTMLElement>) => void
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void
  onDragStart?: (e: DragEvent<HTMLElement>) => void
  onDragOver?: (e: DragEvent<HTMLElement>) => void
  onDragEnd?: (e: DragEvent<HTMLElement>) => void
  onDrop?: (e: DragEvent<HTMLElement>) => void
  draggable?: boolean
  dragging?: boolean
  dropIndicator?: 'before' | 'after'
  prefix?: ReactNode
  suffix?: ReactNode
  variant?: UnderlineTabVariant
}

export function UnderlineTab({
  active = false,
  children,
  className,
  'data-testid': testId,
  'aria-label': ariaLabel,
  title,
  autoScrollOnActive = true,
  onClick,
  onSelect,
  onAuxClick,
  onContextMenu,
  onKeyDown,
  onPointerDown,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  draggable,
  dragging = false,
  dropIndicator,
  prefix,
  suffix,
  variant = 'default',
}: UnderlineTabProps) {
  const elementRef = useRef<HTMLDivElement | HTMLButtonElement>(null)

  useEffect(() => {
    if (autoScrollOnActive && active && elementRef.current) {
      elementRef.current.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [active, autoScrollOnActive])

  const split = prefix != null || suffix != null
  const handleSelect = onSelect ?? onClick
  const dropIndicatorClass =
    dropIndicator === 'before'
      ? styles.dropBefore
      : dropIndicator === 'after'
        ? styles.dropAfter
        : ''

  if (split) {
    const cellClass = [
      styles.cell,
      TAB_VARIANT_CLASS[variant],
      active ? styles.cellActive : '',
      dragging ? styles.dragging : '',
      dropIndicatorClass,
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ')

    const onLabelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(e as KeyboardEvent<HTMLElement>)
      if (e.key !== 'Enter' && e.key !== ' ') {
        return
      }
      e.preventDefault()
      handleSelect?.()
    }

    const onContainerDragStart = (e: DragEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) {
        return
      }
      onDragStart?.(e as DragEvent<HTMLElement>)
    }

    const onContainerDragOver = (e: DragEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) {
        return
      }
      onDragOver?.(e as DragEvent<HTMLElement>)
    }

    const onContainerDragEnd = (e: DragEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) {
        return
      }
      onDragEnd?.(e as DragEvent<HTMLElement>)
    }

    const onContainerDrop = (e: DragEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) {
        return
      }
      onDrop?.(e as DragEvent<HTMLElement>)
    }

    const onContainerPointerDown = (e: PointerEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) {
        return
      }
      onPointerDown?.(e as PointerEvent<HTMLElement>)
    }

    return (
      <div
        ref={elementRef as React.RefObject<HTMLDivElement>}
        className={cellClass}
        data-active={active ? true : undefined}
        data-testid={testId}
        title={title}
        onAuxClick={onAuxClick}
        onContextMenu={onContextMenu}
        onPointerDown={onContainerPointerDown}
        onDragStart={onContainerDragStart}
        onDragOver={onContainerDragOver}
        onDragEnd={onContainerDragEnd}
        onDrop={onContainerDrop}
        draggable={draggable}
        onMouseDown={
          onAuxClick
            ? (e) => {
                if (e.button === 1) e.preventDefault()
              }
            : undefined
        }
      >
        <div
          role="button"
          tabIndex={0}
          aria-label={ariaLabel}
          aria-selected={active}
          className={styles.labelButton}
          onClick={handleSelect}
          onKeyDown={onLabelKeyDown}
          onPointerDown={onPointerDown}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDrop={onDrop}
          draggable={draggable}
        >
          {prefix}
          {children}
        </div>
        {suffix != null ? (
          <div
            className={styles.suffixSlot}
            onPointerDown={onPointerDown}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDrop={onDrop}
            draggable={draggable}
          >
            {suffix}
          </div>
        ) : null}
      </div>
    )
  }

  const simpleClass = [
    styles.simple,
    TAB_VARIANT_CLASS[variant],
    active ? styles.simpleActive : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  const finalSimpleClass = [simpleClass, dragging ? styles.dragging : '', dropIndicatorClass]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      ref={elementRef as React.RefObject<HTMLButtonElement>}
      type="button"
      className={finalSimpleClass}
      data-active={active ? true : undefined}
      data-testid={testId}
      aria-label={ariaLabel}
      aria-selected={active}
      title={title}
      onClick={handleSelect}
      onAuxClick={onAuxClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      draggable={draggable}
      onMouseDown={
        onAuxClick
          ? (e) => {
              if (e.button === 1) e.preventDefault()
            }
          : undefined
      }
    >
      {children}
    </button>
  )
}
