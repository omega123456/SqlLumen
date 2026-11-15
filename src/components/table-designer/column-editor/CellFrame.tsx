import type { ReactNode } from 'react'
import { joinClassNames } from '../../../lib/class-names'

interface CellFrameProps {
  modified: boolean
  testId: string
  className?: string
  children: ReactNode
}

export function CellFrame({ modified, testId, className, children }: CellFrameProps) {
  return (
    <div className={joinClassNames(['relative', className])} data-testid={testId}>
      {modified && (
        <span
          className="absolute top-0 right-0 size-0 border-t-8 border-l-8 border-t-light-primary border-l-transparent dark:border-t-dark-primary"
          aria-hidden
          data-testid={`${testId}-modified`}
        />
      )}
      {children}
    </div>
  )
}
