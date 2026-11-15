import type { HTMLAttributes, ReactNode, Ref } from 'react'
import { joinClassNames } from '../../lib/class-names'
import { FOCUS_RING } from '../../lib/focus-ring'

export type InfoBarSeverity = 'info' | 'success' | 'warning' | 'error'

const GLYPH: Record<InfoBarSeverity, string> = {
  info: 'i',
  success: '✓',
  warning: '!',
  error: '✕',
}

const BAR_FILL_CLASSES: Record<InfoBarSeverity, string> = {
  info: 'bg-light-surface-container-high dark:bg-dark-surface-container-high',
  success: 'bg-light-tertiary-container dark:bg-dark-tertiary-container',
  warning: 'bg-light-warning-container dark:bg-dark-warning-container',
  error: 'bg-light-error-container dark:bg-dark-error-container',
}

const GLYPH_FILL_CLASSES: Record<InfoBarSeverity, string> = {
  info: 'bg-light-primary dark:bg-dark-primary',
  success: 'bg-light-tertiary dark:bg-dark-tertiary',
  warning: 'bg-light-warning dark:bg-dark-warning',
  error: 'bg-light-error dark:bg-dark-error',
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
      className={joinClassNames([
        'flex select-text items-start gap-3 rounded-card border py-3 pr-2 pl-3.5 font-body text-body border-light-stroke-card dark:border-dark-stroke-card text-light-on-surface dark:text-dark-on-surface',
        BAR_FILL_CLASSES[severity],
        FOCUS_RING,
        className,
      ])}
    >
      <span
        className={joinClassNames([
          'mt-0.5 inline-grid size-4 flex-none place-items-center rounded-round text-size-glyph font-extrabold leading-flat text-light-surface dark:text-dark-surface',
          GLYPH_FILL_CLASSES[severity],
        ])}
        aria-hidden="true"
      >
        {GLYPH[severity]}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5 gap-y-1">
        {title != null ? <b className="font-semibold">{title}</b> : null}
        {message != null ? (
          <span className="wrap-anywhere text-light-on-surface dark:text-dark-on-surface">
            {message}
          </span>
        ) : null}
        {detail != null ? (
          <span className="w-full text-size-row text-light-on-surface-variant dark:text-dark-on-surface-variant">
            {detail}
          </span>
        ) : null}
      </div>
      {actions != null ? (
        <div className="flex flex-none items-center gap-1.5">{actions}</div>
      ) : null}
    </div>
  )
}
