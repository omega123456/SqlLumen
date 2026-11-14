import { logFrontend } from './app-log-commands'
import { hasWindow } from './tauri-env'

const TAURI_WEBVIEW_MARKER = '_WRY_INITIALIZED_'
const EDITABLE_CONTENTEDITABLE_VALUES: ReadonlySet<string | null> = new Set([
  'true',
  'plaintext-only',
])

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

export function isEditableFieldElement(target: EventTarget | null): boolean {
  return resolveEditableFieldFromTarget(target) !== null
}

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
