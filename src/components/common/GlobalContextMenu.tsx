import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardText, CopySimple, Scissors } from '@phosphor-icons/react'
import { useDismissOnOutsideClick } from '../connection-dialog/useDismissOnOutsideClick'
import {
  getContextMenuPortalRoot,
  positionContextMenuInPortal,
  readClipboardText,
  resolveEditableFieldFromTarget,
  isInsideDisabledTextControl,
  writeClipboardText,
} from '../../lib/context-menu-utils'

interface OpenState {
  x: number
  y: number
  field: HTMLElement
  portalRoot: HTMLElement
  /** Snapshot for inputs/textareas — focus can move before the menu renders and clear selection. */
  textSelection?: { start: number; end: number }
}

function contentEditableHasSelection(host: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) {
    return false
  }
  const r = sel.getRangeAt(0)
  if (!host.contains(r.commonAncestorContainer)) {
    return false
  }
  return !r.collapsed
}

async function runCut(field: HTMLElement, textSelection?: { start: number; end: number }): Promise<void> {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    if (field.readOnly) {
      return
    }
    const start = textSelection?.start ?? field.selectionStart ?? 0
    const end = textSelection?.end ?? field.selectionEnd ?? 0
    if (start === end) {
      return
    }
    const slice = field.value.slice(start, end)
    await writeClipboardText(slice)
    field.value = field.value.slice(0, start) + field.value.slice(end)
    field.setSelectionRange(start, start)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }

  field.focus()
  document.execCommand('cut')
}

async function runCopy(field: HTMLElement, textSelection?: { start: number; end: number }): Promise<void> {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const start = textSelection?.start ?? field.selectionStart ?? 0
    const end = textSelection?.end ?? field.selectionEnd ?? 0
    if (start === end) {
      return
    }
    await writeClipboardText(field.value.slice(start, end))
    return
  }

  field.focus()
  document.execCommand('copy')
}

async function runPaste(field: HTMLElement, textSelection?: { start: number; end: number }): Promise<void> {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    if (field.readOnly) {
      return
    }
    const text = await readClipboardText()
    const start = textSelection?.start ?? field.selectionStart ?? 0
    const end = textSelection?.end ?? field.selectionEnd ?? 0
    const v = field.value
    field.value = v.slice(0, start) + text + v.slice(end)
    const pos = start + text.length
    field.setSelectionRange(pos, pos)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }

  field.focus()
  const ok = document.execCommand('paste')
  if (!ok) {
    const text = await readClipboardText()
    if (!text) {
      return
    }
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) {
      return
    }
    const range = sel.getRangeAt(0)
    if (!field.contains(range.commonAncestorContainer)) {
      return
    }
    range.deleteContents()
    range.insertNode(document.createTextNode(text))
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

function menuFlags(
  field: HTMLElement,
  textSelection?: { start: number; end: number }
): { canCopy: boolean; canCut: boolean; canPaste: boolean } {
  const readOnly =
    (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && field.readOnly

  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const start = textSelection?.start ?? field.selectionStart ?? 0
    const end = textSelection?.end ?? field.selectionEnd ?? 0
    const hasSel = Math.abs(end - start) > 0
    return {
      canCopy: hasSel,
      canCut: hasSel && !readOnly,
      canPaste: !readOnly,
    }
  }

  const hasSel = contentEditableHasSelection(field)
  return {
    canCopy: hasSel,
    canCut: hasSel,
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

  useDismissOnOutsideClick(menuRef, open !== null, closeMenu, { closeOnEscape: true })

  useLayoutEffect(() => {
    if (!open || !menuRef.current) {
      return
    }
    const el = menuRef.current
    const rect = el.getBoundingClientRect()
    const pos = positionContextMenuInPortal(open.portalRoot, open.x, open.y, rect.width, rect.height)
    el.style.left = `${pos.x}px`
    el.style.top = `${pos.y}px`
  }, [open])

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()

      if (isInsideDisabledTextControl(e.target)) {
        e.stopPropagation()
        return
      }

      const field = resolveEditableFieldFromTarget(e.target)
      if (!field) {
        return
      }

      e.stopPropagation()
      let textSelection: { start: number; end: number } | undefined
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        textSelection = {
          start: field.selectionStart ?? 0,
          end: field.selectionEnd ?? 0,
        }
      }
      setOpen({
        x: e.clientX,
        y: e.clientY,
        field,
        portalRoot: getContextMenuPortalRoot(field),
        textSelection,
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

  const handleAction = (fn: () => Promise<void>) => {
    void (async () => {
      try {
        await fn()
      } catch {
        // Clipboard failures are environment-specific; keep menu usable
      } finally {
        closeMenu()
      }
    })()
  }

  return createPortal(
    <div
      ref={menuRef}
      className="ui-context-menu"
      style={{ left: open.x, top: open.y }}
      role="menu"
      data-testid="global-context-menu"
      onMouseDown={(e) => {
        e.preventDefault()
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
