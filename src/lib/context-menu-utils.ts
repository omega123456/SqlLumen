/** Input types that support text editing context actions (cut/copy/paste). */
const EDITABLE_INPUT_TYPES = new Set([
  '',
  'email',
  'number',
  'password',
  'search',
  'tel',
  'text',
  'url',
])

/**
 * Keeps a fixed-position context menu inside the viewport.
 */
export function clampContextMenuPosition(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  viewportW: number,
  viewportH: number,
  margin = 4
): { x: number; y: number } {
  let nx = x
  let ny = y

  if (nx + menuWidth + margin > viewportW) {
    nx = viewportW - menuWidth - margin
  }
  if (ny + menuHeight + margin > viewportH) {
    ny = viewportH - menuHeight - margin
  }

  nx = Math.max(margin, nx)
  ny = Math.max(margin, ny)

  return { x: nx, y: ny }
}

/**
 * Context menus use `position: fixed`. Inside a transformed `<dialog>` (e.g. centered with translate),
 * fixed is relative to the dialog — not the viewport — and modal dialogs paint in the top layer, so
 * menus must be portaled **into** the open dialog and positioned in **local** coordinates.
 */
export function getContextMenuPortalRoot(anchor: Element | null): HTMLElement {
  if (typeof document === 'undefined') {
    throw new Error('document is not available')
  }
  if (anchor) {
    const d = anchor.closest('dialog')
    if (d instanceof HTMLDialogElement && d.open) {
      return d
    }
  }
  return document.body
}

/**
 * Computes `left` / `top` for a fixed menu inside `portalRoot` so it aligns with a viewport pointer.
 */
export function positionContextMenuInPortal(
  portalRoot: HTMLElement,
  clientX: number,
  clientY: number,
  menuWidth: number,
  menuHeight: number,
  margin = 4
): { x: number; y: number } {
  if (portalRoot === document.body) {
    return clampContextMenuPosition(
      clientX,
      clientY,
      menuWidth,
      menuHeight,
      window.innerWidth,
      window.innerHeight,
      margin
    )
  }

  const dr = portalRoot.getBoundingClientRect()
  const localX = clientX - dr.left
  const localY = clientY - dr.top
  return clampContextMenuPosition(localX, localY, menuWidth, menuHeight, dr.width, dr.height, margin)
}

function isContentEditableField(el: HTMLElement): boolean {
  const raw = el.getAttribute('contenteditable')
  if (raw === 'false') {
    return false
  }
  if (raw === 'true' || raw === 'plaintext-only') {
    return true
  }
  if (el.closest('[contenteditable="false"]')) {
    return false
  }
  return el.isContentEditable
}

/**
 * True when the event target is inside an editable field we handle with the global text menu.
 * Read-only text fields return true (copy may still apply); disabled fields return false.
 */
export function isEditableFieldElement(target: EventTarget | null): boolean {
  return resolveEditableFieldFromTarget(target) !== null
}

/**
 * Returns the host element to focus for cut/copy/paste, or null if we should not show the text menu.
 */
export function resolveEditableFieldFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!target || !(target instanceof Node)) {
    return null
  }

  const startEl =
    target.nodeType === Node.TEXT_NODE ? (target.parentElement as Element | null) : (target as Element)

  if (!startEl) {
    return null
  }

  const inputOrTextarea = startEl.closest('input, textarea')
  if (inputOrTextarea instanceof HTMLTextAreaElement) {
    if (inputOrTextarea.disabled) {
      return null
    }
    return inputOrTextarea
  }
  if (inputOrTextarea instanceof HTMLInputElement) {
    if (inputOrTextarea.disabled) {
      return null
    }
    const t = inputOrTextarea.type.toLowerCase()
    if (!EDITABLE_INPUT_TYPES.has(t)) {
      return null
    }
    return inputOrTextarea
  }

  const contentHost = startEl.closest('[contenteditable]')
  if (contentHost instanceof HTMLElement && isContentEditableField(contentHost)) {
    return contentHost
  }

  return null
}

/**
 * True when the target is inside a disabled text control (suppress native menu without opening group menus, etc.).
 */
export function isInsideDisabledTextControl(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) {
    return false
  }
  const el = target.closest('input, textarea')
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.disabled
  }
  return false
}

export async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  throw new Error('Clipboard unavailable')
}

export async function readClipboardText(): Promise<string> {
  if (navigator.clipboard?.readText) {
    return navigator.clipboard.readText()
  }
  throw new Error('Clipboard unavailable')
}
