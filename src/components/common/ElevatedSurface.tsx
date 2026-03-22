import type { HTMLAttributes } from 'react'

function joinClasses(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export type ElevatedSurfaceProps = HTMLAttributes<HTMLDivElement>

export function ElevatedSurface({ className, children, ...rest }: ElevatedSurfaceProps) {
  return (
    <div className={joinClasses('ui-elevated-surface', className)} {...rest}>
      {children}
    </div>
  )
}
