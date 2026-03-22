import type { CSSProperties, ReactNode } from 'react'
import styles from './UnderlineTabs.module.css'

export interface UnderlineTabBarProps {
  children: ReactNode
  className?: string
  'data-testid'?: string
}

export function UnderlineTabBar({ children, className, 'data-testid': testId }: UnderlineTabBarProps) {
  const barClass = className ? `${styles.bar} ${className}` : styles.bar
  return (
    <div className={barClass} data-testid={testId}>
      {children}
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
  prefix,
  suffix,
}: UnderlineTabProps) {
  const split = prefix != null || suffix != null
  const indicatorStyle: CSSProperties | undefined = indicatorColor
    ? ({ '--underline-tab-indicator': indicatorColor } as CSSProperties)
    : undefined
  const handleSelect = onSelect ?? onClick

  if (split) {
    const cellClass = [
      styles.cell,
      active ? styles.cellActive : '',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <div
        className={cellClass}
        data-active={active ? true : undefined}
        data-testid={testId}
        style={indicatorStyle}
        title={title}
      >
        <button type="button" className={styles.labelButton} onClick={handleSelect}>
          {prefix}
          {children}
        </button>
        {suffix != null ? <div className={styles.suffixSlot}>{suffix}</div> : null}
      </div>
    )
  }

  const simpleClass = [
    styles.simple,
    active ? styles.simpleActive : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={simpleClass}
      data-active={active ? true : undefined}
      data-testid={testId}
      style={indicatorStyle}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
