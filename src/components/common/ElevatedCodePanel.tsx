import type { HTMLAttributes, ReactNode } from 'react'
import { ElevatedSurface } from './ElevatedSurface'
import styles from './ElevatedCodePanel.module.css'

function joinClasses(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export interface ElevatedCodePanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Primary toolbar text — styled like a data table column header. */
  label: ReactNode
  /** Right side of the toolbar (e.g. Copy). */
  headerActions?: ReactNode
  /** Placed inside `<pre><code>` (pass `<code>` or fragment with spans). */
  children: ReactNode
}

export function ElevatedCodePanel({
  label,
  headerActions,
  children,
  className,
  ...rest
}: ElevatedCodePanelProps) {
  return (
    <ElevatedSurface className={joinClasses(styles.shell, className)} {...rest}>
      <div className="ui-elevated-panel-header">
        <span className="ui-elevated-panel-header__label">{label}</span>
        {headerActions ? (
          <div className="ui-elevated-panel-header__actions">{headerActions}</div>
        ) : null}
      </div>
      <div className={styles.body}>
        <pre className={styles.pre}>
          <code>{children}</code>
        </pre>
      </div>
    </ElevatedSurface>
  )
}
