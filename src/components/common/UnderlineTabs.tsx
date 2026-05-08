import {
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
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
  /** When set with split layout, underline uses this color (default: primary). */
  indicatorColor?: string
  title?: string
  /** Simple tab: one button, use onClick. */
  onClick?: () => void
  /** Split tab: main label action. */
  onSelect?: () => void
  /** Middle-click (auxiliary button); use e.preventDefault() in the handler to suppress browser autoscroll. */
  onAuxClick?: (e: MouseEvent<HTMLElement>) => void
  prefix?: ReactNode
  suffix?: ReactNode
}

export function UnderlineTab({
  active = false,
  children,
  className,
  'data-testid': testId,
  indicatorColor,
  title,
  onClick,
  onSelect,
  onAuxClick,
  prefix,
  suffix,
}: UnderlineTabProps) {
  const elementRef = useRef<HTMLDivElement | HTMLButtonElement>(null)

  useEffect(() => {
    if (active && elementRef.current) {
      elementRef.current.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [active])

  const split = prefix != null || suffix != null
  const indicatorStyle: CSSProperties | undefined = indicatorColor
    ? ({ '--underline-tab-indicator': indicatorColor } as CSSProperties)
    : undefined
  const handleSelect = onSelect ?? onClick

  if (split) {
    const cellClass = [styles.cell, active ? styles.cellActive : '', className ?? '']
      .filter(Boolean)
      .join(' ')

    const onLabelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') {
        return
      }
      e.preventDefault()
      handleSelect?.()
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
          className={styles.labelButton}
          onClick={handleSelect}
          onKeyDown={onLabelKeyDown}
        >
          {prefix}
          {children}
        </div>
        {suffix != null ? <div className={styles.suffixSlot}>{suffix}</div> : null}
      </div>
    )
  }

  const simpleClass = [styles.simple, active ? styles.simpleActive : '', className ?? '']
    .filter(Boolean)
    .join(' ')

  return (
    <button
      ref={elementRef as React.RefObject<HTMLButtonElement>}
      type="button"
      className={simpleClass}
      data-active={active ? true : undefined}
      data-testid={testId}
      style={indicatorStyle}
      title={title}
      onClick={handleSelect}
      onAuxClick={onAuxClick}
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
