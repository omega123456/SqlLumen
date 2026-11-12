import type { ShortcutBinding } from '../types/schema'

const IS_MAC = typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.userAgent)

const MODIFIER_LABELS: Partial<Record<string, string>> = {
  ctrl: IS_MAC ? '⌘' : 'Ctrl',
  shift: IS_MAC ? '⇧' : 'Shift',
  alt: IS_MAC ? '⌥' : 'Alt',
}

const KEY_LABELS: Partial<Record<string, string>> = {
  Enter: IS_MAC ? '↩' : 'Enter',
  ' ': 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
}

/** Map internal modifier names to display labels. */
function modifierLabel(modifier: string): string {
  return MODIFIER_LABELS[modifier] ?? modifier
}

/** Map key names to friendlier display labels. */
function keyLabel(key: string): string {
  const namedKeyLabel = KEY_LABELS[key]
  if (namedKeyLabel) return namedKeyLabel
  return key.length === 1 ? key.toUpperCase() : key
}

/** Display labels for a shortcut binding, modifiers first (e.g. `['Ctrl', 'K']`). */
export function shortcutLabelParts(binding: ShortcutBinding): string[] {
  return [...binding.modifiers.map(modifierLabel), keyLabel(binding.key)]
}
