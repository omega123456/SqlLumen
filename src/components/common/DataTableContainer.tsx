import type { HTMLAttributes } from 'react'
import { ElevatedSurface } from './ElevatedSurface'
import styles from './DataTableContainer.module.css'

function joinClasses(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export interface DataTableContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** When false, only the horizontal scroll shell is rendered (parent supplies `.ui-elevated-surface`). */
  elevated?: boolean
}

export function DataTableContainer({
  children,
  className,
  elevated = true,
  ...rest
}: DataTableContainerProps) {
  const scroll = (
    <div className={joinClasses(styles.scrollInner, className)} {...rest}>
      {children}
    </div>
  )

  if (!elevated) {
    return scroll
  }

  return <ElevatedSurface className={styles.elevatedOuter}>{scroll}</ElevatedSurface>
}
