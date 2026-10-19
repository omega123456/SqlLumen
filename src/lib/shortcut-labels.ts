import type { ShortcutBinding } from '../types/schema'

const IS_MAC = typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.userAgent)

/** Map internal modifier names to display labels. */
function modifierLabel(mod: string): string {
  switch (mod) {
    case 'ctrl':
      return IS_MAC ? '⌘' : 'Ctrl'
    case 'shift':
      return IS_MAC ? '⇧' : 'Shift'
    case 'alt':
      return IS_MAC ? '⌥' : 'Alt'
    default:
      return mod
  }
}

/** Map key names to friendlier display labels. */
function keyLabel(key: string): string {
  switch (key) {
    case 'Enter':
      return IS_MAC ? '↩' : 'Enter'
    case ' ':
      return 'Space'
    case 'ArrowUp':
      return '↑'
    case 'ArrowDown':
      return '↓'
    case 'Escape':
      return 'Esc'
    default:
      return key.length === 1 ? key.toUpperCase() : key
  }
}

/** Display labels for a shortcut binding, modifiers first (e.g. `['Ctrl', 'K']`). */
export function shortcutLabelParts(binding: ShortcutBinding): string[] {
  return [...binding.modifiers.map(modifierLabel), keyLabel(binding.key)]
}
