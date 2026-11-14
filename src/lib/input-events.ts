const MIDDLE_MOUSE_BUTTON = 1
const ACTIVATION_KEYS: ReadonlySet<string> = new Set(['Enter', ' '])
const INTERACTIVE_TAG_NAMES: ReadonlySet<string> = new Set([
  'button',
  'input',
  'select',
  'textarea',
  'a',
])

export function isMiddleMouseButton(event: { button: number }): boolean {
  return event.button === MIDDLE_MOUSE_BUTTON
}

export function isActivationKey(key: string): boolean {
  return ACTIVATION_KEYS.has(key)
}

export function isContextMenuKey(event: { key: string; shiftKey: boolean }): boolean {
  const isShiftF10 = event.shiftKey && event.key === 'F10'
  return event.key === 'ContextMenu' || isShiftF10
}

export function isInteractiveElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return INTERACTIVE_TAG_NAMES.has(target.tagName.toLowerCase()) || target.isContentEditable
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

export function elementOf(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null
}

export function isTargetWithin(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null
}

export function isTargetInside(
  container: Node | null | undefined,
  target: EventTarget | null
): boolean {
  return target instanceof Node && container?.contains(target) === true
}
