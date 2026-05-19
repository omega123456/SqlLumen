import type { HTMLAttributes, ReactNode } from 'react'
import { ElevatedSurface } from './ElevatedSurface'
import styles from './ElevatedCodePanel.module.css'

function joinClasses(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export interface ElevatedCodePanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Primary toolbar text — styled like a data table column header. */
  label?: ReactNode
  /** Right side of the toolbar (e.g. Copy). */
  headerActions?: ReactNode
  /** Reuse the shared shell/body without rendering the toolbar row. */
  hideHeader?: boolean
  /** Optional class on the body wrapper. */
  bodyClassName?: string
  /** Optional class on the `<pre>` element. */
  preClassName?: string
  /** Optional class on the `<code>` element. */
  codeClassName?: string
  /** Placed inside `<pre><code>` (pass `<code>` or fragment with spans). */
  children: ReactNode
}

export function ElevatedCodePanel({
  label,
  headerActions,
  hideHeader = false,
  bodyClassName,
  preClassName,
  codeClassName,
  children,
  className,
  ...rest
}: ElevatedCodePanelProps) {
  const showHeader = !hideHeader && (label !== undefined || headerActions !== undefined)

  return (
    <ElevatedSurface className={joinClasses(styles.shell, className)} {...rest}>
      {showHeader ? (
        <div className="ui-elevated-panel-header">
          <span className="ui-elevated-panel-header__label">{label}</span>
          {headerActions ? (
            <div className="ui-elevated-panel-header__actions">{headerActions}</div>
          ) : null}
        </div>
      ) : null}
      <div className={joinClasses(styles.body, bodyClassName)}>
        <pre className={joinClasses(styles.pre, preClassName)}>
          <code className={codeClassName}>{children}</code>
        </pre>
      </div>
    </ElevatedSurface>
  )
}
