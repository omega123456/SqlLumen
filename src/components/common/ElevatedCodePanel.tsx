import type { HTMLAttributes, ReactNode } from 'react'
import { ElevatedSurface } from './ElevatedSurface'
import styles from './ElevatedCodePanel.module.css'

function joinClasses(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export interface ElevatedCodePanelProps extends HTMLAttributes<HTMLDivElement> {
  label?: ReactNode
  headerActions?: ReactNode
  hideHeader?: boolean
  bodyClassName?: string
  preClassName?: string
  codeClassName?: string
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
