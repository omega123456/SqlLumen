import type { HTMLAttributes } from 'react'
import { joinClassNames, SCROLLBAR } from '../../lib/class-names'
import { ElevatedSurface } from './ElevatedSurface'

export interface DataTableContainerProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean
}

export function DataTableContainer({
  children,
  className,
  elevated = true,
  ...rest
}: DataTableContainerProps) {
  const scroll = (
    <div
      className={joinClassNames([
        'overflow-x-auto',
        SCROLLBAR,
        elevated ? 'rounded-card' : undefined,
        className,
      ])}
      {...rest}
    >
      {children}
    </div>
  )

  if (!elevated) {
    return scroll
  }

  return (
    <ElevatedSurface variant="bordered" className="overflow-hidden">
      {scroll}
    </ElevatedSurface>
  )
}
