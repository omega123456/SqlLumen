import type { ShortcutBinding } from '../../types/schema'
import { shortcutLabelParts } from '../../lib/shortcut-labels'
import styles from './KeyCapBadge.module.css'

export interface KeyCapBadgeProps {
  binding: ShortcutBinding
  className?: string
}

export function KeyCapBadge({ binding, className }: KeyCapBadgeProps) {
  const parts = shortcutLabelParts(binding)

  return (
    <span className={`${styles.badge}${className ? ` ${className}` : ''}`}>
      {parts.map((part, i) => (
        <kbd key={i} className={styles.key}>
          {part}
        </kbd>
      ))}
    </span>
  )
}
