import type { ComponentProps } from 'react'
import { joinClassNames } from '../../../lib/class-names'
import { PaginationGroup } from '../../shared/toolbar/PaginationGroup'

export type LogPaginationBarEdge = 'top' | 'bottom'

const EDGE_CLASSES: Record<LogPaginationBarEdge, string> = {
  top: 'border-b border-light-stroke-divider dark:border-dark-stroke-divider',
  bottom: 'border-t border-light-stroke-divider dark:border-dark-stroke-divider',
}

export interface LogPaginationBarProps {
  edge: LogPaginationBarEdge
  paginationProps: ComponentProps<typeof PaginationGroup>
  countSummary: string
  summaryTestId?: string
}

export function LogPaginationBar({
  edge,
  paginationProps,
  countSummary,
  summaryTestId,
}: LogPaginationBarProps) {
  return (
    <div
      className={joinClassNames([
        'flex items-center justify-between gap-3 bg-light-surface-container-lowest p-3 dark:bg-dark-surface-container-lowest',
        EDGE_CLASSES[edge],
      ])}
    >
      <PaginationGroup {...paginationProps} />
      <span
        className="text-size-caption whitespace-nowrap text-light-on-surface-variant dark:text-dark-on-surface-variant"
        data-testid={summaryTestId}
      >
        {countSummary}
      </span>
    </div>
  )
}
