import type { HTMLAttributes, ReactNode, Ref } from 'react'
import styles from './InfoBar.module.css'

export type InfoBarSeverity = 'info' | 'success' | 'warning' | 'error'

const GLYPH: Record<InfoBarSeverity, string> = {
  info: 'i',
  success: '✓',
  warning: '!',
  error: '✕',
}

export type InfoBarProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  severity: InfoBarSeverity
  title?: ReactNode
  message?: ReactNode
  detail?: ReactNode
  actions?: ReactNode
  polite?: boolean
  ref?: Ref<HTMLDivElement>
}

export function InfoBar({
  severity,
  title,
  message,
  detail,
  actions,
  polite = false,
  className,
  ref,
  ...rest
}: InfoBarProps) {
  const isUrgent = !polite && (severity === 'error' || severity === 'warning')
  return (
    <div
      ref={ref}
      role={isUrgent ? 'alert' : 'status'}
      aria-live={polite ? 'polite' : undefined}
      data-severity={severity}
      {...rest}
      className={[styles.bar, styles[severity], className].filter(Boolean).join(' ')}
    >
      <span className={styles.glyph} aria-hidden="true">
        {GLYPH[severity]}
      </span>
      <div className={styles.text}>
        {title != null ? <b className={styles.title}>{title}</b> : null}
        {message != null ? <span className={styles.message}>{message}</span> : null}
        {detail != null ? <span className={styles.detail}>{detail}</span> : null}
      </div>
      {actions != null ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  )
}
