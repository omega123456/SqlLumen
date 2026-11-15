import type { HTMLAttributes, ReactNode } from 'react'
import { joinClassNames, SCROLLBAR } from '../../lib/class-names'
import { ElevatedSurface, type ElevatedSurfaceVariant } from './ElevatedSurface'

export type ElevatedCodePanelHeaderVariant = 'table' | 'strip'

export type ElevatedCodePanelPreSpacing = 'standard' | 'snug' | 'listing'

const PRE_SPACING_CLASSES: Record<ElevatedCodePanelPreSpacing, string> = {
  standard: 'p-4 text-mono',
  snug: 'px-4 py-3.5 text-mono',
  listing: 'px-4 py-3.5 text-mono-relaxed',
}

const HEADER_VARIANT_CLASSES: Record<ElevatedCodePanelHeaderVariant, string> = {
  table: 'px-3 py-2',
  strip: 'h-8.5 pr-1 pl-3 bg-light-surface-container-high dark:bg-dark-surface-container-high',
}

export interface ElevatedCodePanelProps extends HTMLAttributes<HTMLDivElement> {
  label?: ReactNode
  headerActions?: ReactNode
  headerVariant?: ElevatedCodePanelHeaderVariant
  surfaceVariant?: ElevatedSurfaceVariant
  preSpacing?: ElevatedCodePanelPreSpacing
  hideHeader?: boolean
  bodyClassName?: string
  preClassName?: string
  codeClassName?: string
  children: ReactNode
}

export function ElevatedCodePanel({
  label,
  headerActions,
  headerVariant = 'table',
  surfaceVariant = 'ring',
  preSpacing = 'standard',
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
    <ElevatedSurface
      variant={surfaceVariant}
      className={joinClassNames(['flex min-w-0 flex-col overflow-hidden', className])}
      {...rest}
    >
      {showHeader ? (
        <div
          data-variant={headerVariant}
          className={joinClassNames([
            'flex w-full shrink-0 items-center justify-between gap-3 border-b border-light-stroke-divider dark:border-dark-stroke-divider',
            HEADER_VARIANT_CLASSES[headerVariant],
          ])}
        >
          <span className="min-w-0 font-body text-size-caption font-semibold text-light-on-surface-variant dark:text-dark-on-surface-variant">
            {label}
          </span>
          {headerActions ? (
            <div className="flex shrink-0 items-center gap-2">{headerActions}</div>
          ) : null}
        </div>
      ) : null}
      <div className={joinClassNames(['min-h-0 overflow-x-auto', SCROLLBAR, bodyClassName])}>
        <pre
          data-spacing={preSpacing}
          className={joinClassNames([
            PRE_SPACING_CLASSES[preSpacing],
            'font-mono whitespace-pre-wrap wrap-anywhere text-light-token-text dark:text-dark-token-text',
            preClassName,
          ])}
        >
          <code className={joinClassNames(['font-generic-mono', codeClassName])}>{children}</code>
        </pre>
      </div>
    </ElevatedSurface>
  )
}
