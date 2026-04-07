import type { ShortcutBinding } from '../../types/schema'
import styles from './KeyCapBadge.module.css'

const IS_MAC = typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.userAgent)

/** Map internal modifier names to display labels. */
function modifierLabel(mod: string): string {
  switch (mod) {
    case 'ctrl':
      return IS_MAC ? '\u2318' : 'Ctrl'
    case 'shift':
      return IS_MAC ? '\u21E7' : 'Shift'
    case 'alt':
      return IS_MAC ? '\u2325' : 'Alt'
    default:
      return mod
  }
}

/** Map key names to friendlier display labels. */
function keyLabel(key: string): string {
  switch (key) {
    case 'Enter':
      return IS_MAC ? '\u21A9' : 'Enter'
    case ' ':
      return 'Space'
    case ',':
      return ','
    default:
      return key.length === 1 ? key.toUpperCase() : key
  }
}

export interface KeyCapBadgeProps {
  binding: ShortcutBinding
  className?: string
}

export function KeyCapBadge({ binding, className }: KeyCapBadgeProps) {
  const parts = [...binding.modifiers.map(modifierLabel), keyLabel(binding.key)]

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
