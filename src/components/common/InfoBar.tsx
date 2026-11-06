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
  /** Bold lead-in, e.g. "Error 1146". */
  title?: ReactNode
  message?: ReactNode
  /** Secondary line under the title and message. */
  detail?: ReactNode
  /** Buttons on the right (e.g. retry, dismiss). */
  actions?: ReactNode
  /**
   * Opt-in polite announcement (`role="status"`, `aria-live="polite"`) for
   * warnings and errors that must not interrupt, e.g. the truncation notice.
   * By default warnings and errors are announced as alerts.
   */
  polite?: boolean
  /** Ref to the bar element (e.g. to move focus to a failure). */
  ref?: Ref<HTMLDivElement>
}

/**
 * Inline status bar (Fluent InfoBar). The severity always shows a glyph as well as a colour,
 * so status never relies on colour alone. Errors and warnings are announced as alerts unless
 * `polite` is set.
 */
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
