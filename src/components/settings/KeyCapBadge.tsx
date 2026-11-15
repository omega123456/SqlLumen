import type { ShortcutBinding } from '../../types/schema'
import { shortcutLabelParts } from '../../lib/shortcut-labels'

export interface KeyCapBadgeProps {
  binding: ShortcutBinding
}

export function KeyCapBadge({ binding }: KeyCapBadgeProps) {
  const parts = shortcutLabelParts(binding)

  return (
    <span className="inline-flex items-center gap-1">
      {parts.map((part, index) => (
        <kbd
          key={index}
          className="inline-flex h-6 min-w-6 items-center justify-center rounded-control border border-light-outline-variant bg-light-surface-container-high px-1.5 font-mono text-size-caption leading-flat font-regular whitespace-nowrap text-light-on-surface select-none dark:border-dark-outline-variant dark:bg-dark-surface-container-high dark:text-dark-on-surface"
        >
          {part}
        </kbd>
      ))}
    </span>
  )
}
