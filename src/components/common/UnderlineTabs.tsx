import {
  useEffect,
  useRef,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
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
  /** Content rendered outside the scrollable tab area (e.g. pinned tabs, action buttons). */
  suffix?: ReactNode
  /** When true, always reserve scrollbar space (overflow-x: scroll). Use for tab bars that can overflow. */
  scrollable?: boolean
  variant?: UnderlineTabVariant
}

export function UnderlineTabBar({
  children,
  className,
  'data-testid': testId,
  suffix,
  scrollable,
  variant = 'default',
}: UnderlineTabBarProps) {
  const barClass = [styles.bar, scrollable ? styles.barScrollable : '', BAR_VARIANT_CLASS[variant]]
    .filter(Boolean)
    .join(' ')
  const barChildren = scrollable ? <div className={styles.barContent}>{children}</div> : children
  if (suffix) {
    const wrapperClass = [styles.barWrapper, BAR_VARIANT_CLASS[variant], className]
      .filter(Boolean)
      .join(' ')
    return (
      <div className={wrapperClass} data-testid={testId}>
        <div className={barClass}>{barChildren}</div>
        <div className={styles.barSuffix}>{suffix}</div>
      </div>
    )
  }
  const finalBarClass = className ? `${barClass} ${className}` : barClass
  return (
    <div className={finalBarClass} data-testid={testId}>
      {barChildren}
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
