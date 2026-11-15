import type { HTMLAttributes, ReactNode } from 'react'
import { joinClassNames } from '../../lib/class-names'
import { DataTableContainer } from '../common/DataTableContainer'

export function SchemaPanel({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={joinClassNames(['px-5 py-3 select-text', className])} {...rest}>
      {children}
    </div>
  )
}

interface SchemaTableProps {
  columnLabels: string[]
  children: ReactNode
}

export function SchemaTable({ columnLabels, children }: SchemaTableProps) {
  return (
    <DataTableContainer>
      <table className="w-full border-collapse font-body text-size-row leading-5">
        <thead>
          <tr>
            {columnLabels.map((label) => (
              <th
                key={label}
                className="h-8 border-b border-b-light-stroke-divider bg-light-surface-container px-3.5 text-left font-body text-size-caption font-semibold whitespace-nowrap text-light-on-surface-variant dark:border-b-dark-stroke-divider dark:bg-dark-surface-container dark:text-dark-on-surface-variant"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </DataTableContainer>
  )
}

export type SchemaRowHoverMotion = 'instant' | 'fade'

const ROW_HOVER_MOTION_CLASSES: Record<SchemaRowHoverMotion, string> = {
  instant: '',
  fade: 'transition-bg duration-100',
}

interface SchemaRowProps {
  hoverMotion?: SchemaRowHoverMotion
  children: ReactNode
}

export function SchemaRow({ hoverMotion = 'fade', children }: SchemaRowProps) {
  return (
    <tr
      className={joinClassNames([
        'group/row hover:bg-light-fill-subtle-hover dark:hover:bg-dark-fill-subtle-hover',
        ROW_HOVER_MOTION_CLASSES[hoverMotion],
      ])}
    >
      {children}
    </tr>
  )
}

export function SchemaCell({ children }: { children: ReactNode }) {
  return (
    <td className="h-9 border-b-light-stroke-divider px-3.5 align-middle text-light-on-surface group-not-last/row:border-b dark:border-b-dark-stroke-divider dark:text-dark-on-surface">
      {children}
    </td>
  )
}
