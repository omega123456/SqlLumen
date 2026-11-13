import { logFrontend } from './app-log-commands'
import { hasWindow } from './tauri-env'

const TAURI_WEBVIEW_MARKER = '_WRY_INITIALIZED_'
const EDITABLE_CONTENTEDITABLE_VALUES: ReadonlySet<string | null> = new Set([
  'true',
  'plaintext-only',
])

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

export interface MenuPlacement {
  requestedX: number
  requestedY: number
  menuWidth: number
  menuHeight: number
  viewportWidth: number
  viewportHeight: number
  margin?: number
}

/**
 * Keeps a fixed-position context menu inside the viewport.
 */
export function clampContextMenuPosition({
  requestedX,
  requestedY,
  menuWidth,
  menuHeight,
  viewportWidth,
  viewportHeight,
  margin = 4,
}: MenuPlacement): { x: number; y: number } {
  let clampedX = requestedX
  let clampedY = requestedY

  if (clampedX + menuWidth + margin > viewportWidth) {
    clampedX = viewportWidth - menuWidth - margin
  }
  if (clampedY + menuHeight + margin > viewportHeight) {
    clampedY = viewportHeight - menuHeight - margin
  }

  clampedX = Math.max(margin, clampedX)
  clampedY = Math.max(margin, clampedY)

  return { x: clampedX, y: clampedY }
}

export interface ContextMenuOpenPoint {
  x: number
  y: number
  anchor: Element | null
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
  const dialog = anchor?.closest('dialog') ?? null
  if (isOpenDialog(dialog)) {
    return dialog
  }
  return document.body
}

function isOpenDialog(element: Element | null): element is HTMLDialogElement {
  return element instanceof HTMLDialogElement && element.open
}

function isDocumentBody(element: HTMLElement): boolean {
  return element === element.ownerDocument.body
}

export interface PortalMenuPlacement {
  portalRoot: HTMLElement
  clientX: number
  clientY: number
  menuWidth: number
  menuHeight: number
  margin?: number
}

/**
 * Computes `left` / `top` for a fixed menu inside `portalRoot` so it aligns with a viewport pointer.
 */
export function positionContextMenuInPortal({
  portalRoot,
  clientX,
  clientY,
  menuWidth,
  menuHeight,
  margin = 4,
}: PortalMenuPlacement): { x: number; y: number } {
  if (isDocumentBody(portalRoot)) {
    return clampContextMenuPosition({
      requestedX: clientX,
      requestedY: clientY,
      menuWidth: menuWidth,
      menuHeight: menuHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      margin: margin,
    })
  }

  const dr = portalRoot.getBoundingClientRect()
  const localX = clientX - dr.left
  const localY = clientY - dr.top
  return clampContextMenuPosition({
    requestedX: localX,
    requestedY: localY,
    menuWidth: menuWidth,
    menuHeight: menuHeight,
    viewportWidth: dr.width,
    viewportHeight: dr.height,
    margin: margin,
  })
}

/**
 * Dialog-local menus should use absolute positioning because desktop webviews can anchor `position: fixed`
 * differently for top-layer dialog descendants than browsers do.
 */
export function getContextMenuPositionMode(portalRoot: HTMLElement): 'fixed' | 'absolute' {
  return isDocumentBody(portalRoot) ? 'fixed' : 'absolute'
}

function isEditableContentHost(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && isContentEditableField(element)
}

export function isTextControl(
  element: Element | null
): element is HTMLInputElement | HTMLTextAreaElement {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
}

function isTauriWebview(): boolean {
  return hasWindow() && TAURI_WEBVIEW_MARKER in window
}

function isContentEditableField(element: HTMLElement): boolean {
  const raw = element.getAttribute('contenteditable')
  if (raw === 'false') {
    return false
  }
  if (EDITABLE_CONTENTEDITABLE_VALUES.has(raw)) {
    return true
  }
  if (element.closest('[contenteditable="false"]')) {
    return false
  }
  return element.isContentEditable
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
  const startElement = startElementForTarget(target)
  if (!startElement) {
    return null
  }

  const inputOrTextarea = startElement.closest('input, textarea')
  if (inputOrTextarea) {
    return editableTextControl(inputOrTextarea)
  }

  const contentHost = startElement.closest('[contenteditable]')
  if (isEditableContentHost(contentHost)) {
    return contentHost
  }

  return null
}

function startElementForTarget(target: EventTarget | null): Element | null {
  if (!(target instanceof Node)) {
    return null
  }
  if (target.nodeType === Node.TEXT_NODE) {
    return target.parentElement
  }
  return target as Element
}

function editableTextControl(control: Element): HTMLElement | null {
  if (control instanceof HTMLTextAreaElement) {
    return control.disabled ? null : control
  }
  if (!(control instanceof HTMLInputElement)) {
    return null
  }
  if (control.disabled) {
    return null
  }
  const inputType = control.type.toLowerCase()
  if (!EDITABLE_INPUT_TYPES.has(inputType)) {
    return null
  }
  return control
}

/**
 * True when the target is inside a disabled text control (suppress native menu without opening group menus, etc.).
 */
export function isInsideDisabledTextControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }
  const element = target.closest('input, textarea')
  if (isTextControl(element)) {
    return element.disabled
  }
  return false
}

export async function writeClipboardText(text: string): Promise<void> {
  if (isTauriWebview()) {
    try {
      const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
      await writeText(text)
      return
    } catch (error) {
      logFrontend(
        'warn',
        `[context-menu-utils] Tauri clipboard write failed, using the browser clipboard: ${String(error)}`
      )
    }
  }

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
