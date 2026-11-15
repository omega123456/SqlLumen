import type { ReactNode } from 'react'

interface CountBadgeAnchorProps {
  badge: string | null
  badgeTestId: string
  children: ReactNode
}

export function CountBadgeAnchor({ badge, badgeTestId, children }: CountBadgeAnchorProps) {
  return (
    <div className="relative -mt-1 flex items-center overflow-visible pt-1">
      {children}
      {badge !== null && (
        <span
          className="pointer-events-none absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-badge bg-light-primary px-0.5 font-mono text-size-caption font-semibold text-light-on-primary dark:bg-dark-primary dark:text-dark-on-primary"
          data-testid={badgeTestId}
        >
          {badge}
        </span>
      )}
    </div>
  )
}
