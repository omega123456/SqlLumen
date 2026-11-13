import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardText, CopySimple, Scissors } from '@phosphor-icons/react'
import { logFrontend } from '../../lib/app-log-commands'
import { useDismissOnOutsideClick } from '../connection-dialog/useDismissOnOutsideClick'
import {
  getContextMenuPositionMode,
  getContextMenuPortalRoot,
  positionContextMenuInPortal,
  readClipboardText,
  resolveEditableFieldFromTarget,
  isInsideDisabledTextControl,
  isTextControl,
  writeClipboardText,
} from '../../lib/context-menu-utils'
import { DISMISS_ALL_CONTEXT_MENUS, dispatchDismissAll } from '../../lib/context-menu-events'

interface OpenState {
  x: number
  y: number
  field: HTMLElement
  portalRoot: HTMLElement
  /** Snapshot for inputs/textareas — focus can move before the menu renders and clear selection. */
  textSelection?: TextSelectionRange
}

function firstSelectionRange(): Range | null {
  const selection = window.getSelection()
  if (!selection) {
    return null
  }
  if (selection.rangeCount === 0) {
    return null
  }
  return selection.getRangeAt(0)
}

function selectionRangeInside(field: HTMLElement): Range | null {
  const range = firstSelectionRange()
  if (!range) {
    return null
  }
  if (!field.contains(range.commonAncestorContainer)) {
    return null
  }
  return range
}

function contentEditableHasSelection(host: HTMLElement): boolean {
  const range = selectionRangeInside(host)
  if (!range) {
    return false
  }
  return !range.collapsed
}

type TextControl = HTMLInputElement | HTMLTextAreaElement

interface TextSelectionRange {
  start: number
  end: number
}

function currentTextSelection(field: HTMLElement): TextSelectionRange | undefined {
  if (!isTextControl(field)) {
    return undefined
  }
  return {
    start: field.selectionStart ?? 0,
    end: field.selectionEnd ?? 0,
  }
}

function resolveSelectionRange(
  field: TextControl,
  textSelection?: TextSelectionRange
): TextSelectionRange {
  return {
    start: textSelection?.start ?? field.selectionStart ?? 0,
    end: textSelection?.end ?? field.selectionEnd ?? 0,
  }
}

function dispatchValueChange(field: TextControl): void {
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.dispatchEvent(new Event('change', { bubbles: true }))
}

async function runCut(field: HTMLElement, textSelection?: TextSelectionRange): Promise<void> {
  if (isTextControl(field)) {
    if (field.readOnly) {
      return
    }
    const { start, end } = resolveSelectionRange(field, textSelection)
    if (start === end) {
      return
    }
    const slice = field.value.slice(start, end)
    await writeClipboardText(slice)
    field.value = field.value.slice(0, start) + field.value.slice(end)
    field.setSelectionRange(start, start)
    dispatchValueChange(field)
    return
  }

  field.focus()
  document.execCommand('cut')
}

async function runCopy(field: HTMLElement, textSelection?: TextSelectionRange): Promise<void> {
  if (isTextControl(field)) {
    const { start, end } = resolveSelectionRange(field, textSelection)
    if (start === end) {
      return
    }
    await writeClipboardText(field.value.slice(start, end))
    return
  }

  field.focus()
  document.execCommand('copy')
}

async function pasteIntoTextControl(
  field: TextControl,
  textSelection?: TextSelectionRange
): Promise<void> {
  if (field.readOnly) {
    return
  }
  const text = await readClipboardText()
  const { start, end } = resolveSelectionRange(field, textSelection)
  const fieldValue = field.value
  field.value = fieldValue.slice(0, start) + text + fieldValue.slice(end)
  const position = start + text.length
  field.setSelectionRange(position, position)
  dispatchValueChange(field)
}

async function insertClipboardTextAtSelection(field: HTMLElement): Promise<void> {
  const text = await readClipboardText()
  if (!text) {
    return
  }
  const range = selectionRangeInside(field)
  if (!range) {
    return
  }
  const selection = window.getSelection()
  range.deleteContents()
  range.insertNode(document.createTextNode(text))
  range.collapse(false)
  selection?.removeAllRanges()
  selection?.addRange(range)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

async function runPaste(field: HTMLElement, textSelection?: TextSelectionRange): Promise<void> {
  if (isTextControl(field)) {
    await pasteIntoTextControl(field, textSelection)
    return
  }

  field.focus()
  const pastedNatively = document.execCommand('paste')
  if (!pastedNatively) {
    await insertClipboardTextAtSelection(field)
  }
}

function menuFlags(
  field: HTMLElement,
  textSelection?: TextSelectionRange
): { canCopy: boolean; canCut: boolean; canPaste: boolean } {
  if (isTextControl(field)) {
    const readOnly = field.readOnly
    const { start, end } = resolveSelectionRange(field, textSelection)
    const hasSelection = Math.abs(end - start) > 0
    return {
      canCopy: hasSelection,
      canCut: hasSelection && !readOnly,
      canPaste: !readOnly,
    }
  }

  const hasSelection = contentEditableHasSelection(field)
  return {
    canCopy: hasSelection,
    canCut: hasSelection,
    canPaste: true,
  }
}

/**
 * Disables the native context menu app-wide and shows a custom Cut/Copy/Paste menu on editable fields.
 * Other surfaces rely on their own `onContextMenu` handlers (event must not be stopped in capture).
 */
export function GlobalContextMenu() {
  const [open, setOpen] = useState<OpenState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const closeMenu = useCallback(() => {
    setOpen(null)
  }, [])

  useDismissOnOutsideClick({
    ref: menuRef,
    active: open !== null,
    onDismiss: closeMenu,
    options: { closeOnEscape: true },
  })

  useLayoutEffect(() => {
    const element = menuRef.current
    if (!open) return
    if (!element) return
    const rect = element.getBoundingClientRect()
    const position = positionContextMenuInPortal({
      portalRoot: open.portalRoot,
      clientX: open.x,
      clientY: open.y,
      menuWidth: rect.width,
      menuHeight: rect.height,
    })
    element.style.left = `${position.x}px`
    element.style.top = `${position.y}px`
  }, [open])

  // Listen for dismiss-all events dispatched by other context menus
  useEffect(() => {
    const onDismissAll = () => {
      setOpen(null)
    }
    document.addEventListener(DISMISS_ALL_CONTEXT_MENUS, onDismissAll)
    return () => {
      document.removeEventListener(DISMISS_ALL_CONTEXT_MENUS, onDismissAll)
    }
  }, [])

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault()

      if (isInsideDisabledTextControl(event.target)) {
        event.stopPropagation()
        return
      }

      const field = resolveEditableFieldFromTarget(event.target)
      if (!field) {
        return
      }

      event.stopPropagation()

      // Dismiss any other open context menus before opening this one
      dispatchDismissAll()

      const textSelection = currentTextSelection(field)
      setOpen({
        x: event.clientX,
        y: event.clientY,
        field: field,
        portalRoot: getContextMenuPortalRoot(field),
        textSelection: textSelection,
      })
    }

    document.addEventListener('contextmenu', onContextMenu, true)
    return () => {
      document.removeEventListener('contextmenu', onContextMenu, true)
    }
  }, [])

  if (!open) {
    return null
  }

  const { canCopy, canCut, canPaste } = menuFlags(open.field, open.textSelection)

  const handleAction = (action: () => Promise<void>) => {
    void (async () => {
      try {
        await action()
      } catch (error) {
        logFrontend('warn', `[global-context-menu] Clipboard action failed: ${String(error)}`)
      } finally {
        closeMenu()
      }
    })()
  }

  return createPortal(
    <div
      ref={menuRef}
      className="ui-context-menu"
      style={{
        left: open.x,
        top: open.y,
        position: getContextMenuPositionMode(open.portalRoot),
      }}
      role="menu"
      data-testid="global-context-menu"
      onMouseDown={(event) => {
        event.preventDefault()
      }}
    >
      <button
        type="button"
        className="ui-context-menu__item"
        role="menuitem"
        disabled={!canCut}
        data-testid="global-context-cut"
        onClick={() => {
          handleAction(() => runCut(open.field, open.textSelection))
        }}
      >
        <Scissors className="ui-context-menu__icon" size={18} weight="regular" aria-hidden />
        <span>Cut</span>
      </button>
      <button
        type="button"
        className="ui-context-menu__item"
        role="menuitem"
        disabled={!canCopy}
        data-testid="global-context-copy"
        onClick={() => {
          handleAction(() => runCopy(open.field, open.textSelection))
        }}
      >
        <CopySimple className="ui-context-menu__icon" size={18} weight="regular" aria-hidden />
        <span>Copy</span>
      </button>
      <button
        type="button"
        className="ui-context-menu__item"
        role="menuitem"
        disabled={!canPaste}
        data-testid="global-context-paste"
        onClick={() => {
          handleAction(() => runPaste(open.field, open.textSelection))
        }}
      >
        <ClipboardText className="ui-context-menu__icon" size={18} weight="regular" aria-hidden />
        <span>Paste</span>
      </button>
    </div>,
    open.portalRoot
  )
}
