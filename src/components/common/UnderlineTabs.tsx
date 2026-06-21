import {
  useEffect,
  useRef,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import styles from './UnderlineTabs.module.css'

export interface UnderlineTabBarProps {
  children: ReactNode
  className?: string
  'data-testid'?: string
  /** Content rendered outside the scrollable tab area (e.g. pinned tabs, action buttons). */
  suffix?: ReactNode
  /** When true, always reserve scrollbar space (overflow-x: scroll). Use for tab bars that can overflow. */
  scrollable?: boolean
}

export function UnderlineTabBar({
  children,
  className,
  'data-testid': testId,
  suffix,
  scrollable,
}: UnderlineTabBarProps) {
  const barClass = scrollable ? `${styles.bar} ${styles.barScrollable}` : styles.bar
  const barChildren = scrollable ? <div className={styles.barContent}>{children}</div> : children
  if (suffix) {
    const wrapperClass = className ? `${styles.barWrapper} ${className}` : styles.barWrapper
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
  /** When set with split layout, underline uses this color (default: primary). */
  indicatorColor?: string
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
}

export function UnderlineTab({
  active = false,
  children,
  className,
  'data-testid': testId,
  'aria-label': ariaLabel,
  indicatorColor,
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
}: UnderlineTabProps) {
  const elementRef = useRef<HTMLDivElement | HTMLButtonElement>(null)

  useEffect(() => {
    if (autoScrollOnActive && active && elementRef.current) {
      elementRef.current.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [active, autoScrollOnActive])

  const split = prefix != null || suffix != null
  const indicatorStyle: CSSProperties | undefined = indicatorColor
    ? ({ '--underline-tab-indicator': indicatorColor } as CSSProperties)
    : undefined
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
        style={indicatorStyle}
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

  const simpleClass = [styles.simple, active ? styles.simpleActive : '', className ?? '']
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
      style={indicatorStyle}
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
