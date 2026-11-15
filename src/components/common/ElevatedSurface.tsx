import type { HTMLAttributes } from 'react'
import { ELEVATED_SURFACE, joinClassNames } from '../../lib/class-names'

export type ElevatedSurfaceVariant =
  'ring' | 'ringHoverable' | 'ringSelected' | 'bordered' | 'recessed'

const VARIANT_CLASSES: Record<ElevatedSurfaceVariant, string> = {
  ring: ELEVATED_SURFACE,
  ringHoverable: joinClassNames([
    ELEVATED_SURFACE,
    'hover:bg-light-card-hover dark:hover:bg-dark-card-hover',
  ]),
  ringSelected:
    'rounded-card bg-light-card-accent-hover shadow-light-elevated hover:bg-light-card-hover dark:bg-dark-card-accent-hover dark:shadow-dark-elevated dark:hover:bg-dark-card-hover',
  bordered:
    'rounded-card border border-light-stroke-card dark:border-dark-stroke-card bg-light-surface-container-high dark:bg-dark-surface-container-high',
  recessed:
    'rounded-card border border-light-stroke-card dark:border-dark-stroke-card bg-light-surface-container-lowest dark:bg-dark-surface-container-lowest',
}

export type ElevatedSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  variant?: ElevatedSurfaceVariant
}

export function ElevatedSurface({
  variant = 'ring',
  className,
  children,
  ...rest
}: ElevatedSurfaceProps) {
  return (
    <div
      data-variant={variant}
      className={joinClassNames([VARIANT_CLASSES[variant], className])}
      {...rest}
    >
      {children}
    </div>
  )
}
