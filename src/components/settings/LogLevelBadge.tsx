import { joinClassNames } from '../../lib/class-names'

export interface LogLevelBadgeProps {
  level: string
}

const LEVEL_TONE_CLASSES: Record<string, string> = {
  ERROR:
    'border-light-error-a30 bg-light-error-container text-light-error dark:border-dark-error-a30 dark:bg-dark-error-container dark:text-dark-error',
  WARN: 'border-light-warning-a28 bg-light-warning-a16 text-light-warning dark:border-dark-warning-a28 dark:bg-dark-warning-a16 dark:text-dark-warning',
  INFO: 'border-light-primary-a28 bg-light-fill-accent-tint text-light-primary dark:border-dark-primary-a28 dark:bg-dark-fill-accent-tint dark:text-dark-primary',
  DEBUG:
    'border-light-stroke-control bg-light-fill-neutral-selected text-light-secondary dark:border-dark-stroke-control dark:bg-dark-fill-neutral-selected dark:text-dark-secondary',
  TRACE:
    'border-light-primary-a20 bg-light-primary-a12 text-light-surface-tint dark:border-dark-primary-a20 dark:bg-dark-primary-a12 dark:text-dark-surface-tint',
}

export function LogLevelBadge({ level }: LogLevelBadgeProps) {
  const normalizedLevel = level.toUpperCase()
  const toneClassName = LEVEL_TONE_CLASSES[normalizedLevel] ?? LEVEL_TONE_CLASSES.INFO

  return (
    <span
      className={joinClassNames([
        'inline-flex min-w-14 items-center justify-center rounded-pill border px-2 py-0.5 font-body text-size-caption font-semibold whitespace-nowrap',
        toneClassName,
      ])}
    >
      {normalizedLevel}
    </span>
  )
}
