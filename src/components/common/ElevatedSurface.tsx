import type { HTMLAttributes } from 'react'
import { ELEVATED_SURFACE, joinClassNames } from '../../lib/class-names'

export type ElevatedSurfaceVariant = 'ring' | 'bordered'

const VARIANT_CLASSES: Record<ElevatedSurfaceVariant, string> = {
  ring: ELEVATED_SURFACE,
  bordered:
    'rounded-card border border-light-stroke-card dark:border-dark-stroke-card bg-light-surface-container-high dark:bg-dark-surface-container-high',
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
