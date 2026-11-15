import type { ReactNode } from 'react'
import { ELEVATED_SURFACE, joinClassNames } from '../../../lib/class-names'

export function Section({
  title,
  testId,
  children,
}: {
  title: string
  testId?: string
  children: ReactNode
}) {
  return (
    <section
      className={joinClassNames([ELEVATED_SURFACE, 'flex flex-col gap-3 p-4'])}
      data-testid={testId}
    >
      <h3 className="font-headline text-size-caption font-semibold text-light-on-surface dark:text-dark-on-surface">
        {title}
      </h3>
      <div className="flex flex-col">{children}</div>
    </section>
  )
}
