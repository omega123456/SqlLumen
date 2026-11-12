import type { ShortcutBinding } from '../types/schema'

export function bindingsMatch(left: ShortcutBinding, right: ShortcutBinding): boolean {
  const isSameKey = left.key.toLowerCase() === right.key.toLowerCase()
  if (!isSameKey) return false
  const leftModifiers = [...left.modifiers].sort()
  const rightModifiers = [...right.modifiers].sort()
  if (leftModifiers.length !== rightModifiers.length) return false
  return leftModifiers.every((modifier, index) => modifier === rightModifiers[index])
}
