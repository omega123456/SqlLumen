const MIDDLE_MOUSE_BUTTON = 1
const ACTIVATION_KEYS: ReadonlySet<string> = new Set(['Enter', ' '])

export function isMiddleMouseButton(event: { button: number }): boolean {
  return event.button === MIDDLE_MOUSE_BUTTON
}

export function isActivationKey(key: string): boolean {
  return ACTIVATION_KEYS.has(key)
}

export function isPlainEnterKey(event: { key: string; shiftKey: boolean }): boolean {
  return event.key === 'Enter' && !event.shiftKey
}

export function isTargetOutside(
  container: Node | null | undefined,
  target: EventTarget | null
): boolean {
  if (!container) return false
  return !isTargetInside(container, target)
}

export function isTargetInside(
  container: Node | null | undefined,
  target: EventTarget | null
): boolean {
  return target instanceof Node && container?.contains(target) === true
}
