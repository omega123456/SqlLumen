import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardText, CopySimple, Scissors } from '@phosphor-icons/react'
import { logFrontend } from '../../lib/app-log-commands'
import {
  CONTEXT_MENU,
  CONTEXT_MENU_ICON,
  contextMenuItemClassName,
} from '../../lib/class-names-menu'
import { useContextMenuPlacement } from '../../hooks/use-context-menu-placement'
import { useDismissOnOutsideClick } from '../connection-dialog/useDismissOnOutsideClick'
import {
  getContextMenuPositionMode,
  getContextMenuPortalRoot,
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

interface MenuFlags {
  canCopy: boolean
  canCut: boolean
  canPaste: boolean
}

function menuFlags(field: HTMLElement, textSelection?: TextSelectionRange): MenuFlags {
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

const MENU_ICON_SIZE = 18

type ClipboardAction = (field: HTMLElement, textSelection?: TextSelectionRange) => Promise<void>

interface MenuItemSpec {
  key: string
  label: string
  testId: string
  Icon: typeof Scissors
  action: ClipboardAction
  isEnabled: (flags: MenuFlags) => boolean
}

const MENU_ITEMS: MenuItemSpec[] = [
  {
    key: 'cut',
    label: 'Cut',
    testId: 'global-context-cut',
    Icon: Scissors,
    action: runCut,
    isEnabled: (flags) => flags.canCut,
  },
  {
    key: 'copy',
    label: 'Copy',
    testId: 'global-context-copy',
    Icon: CopySimple,
    action: runCopy,
    isEnabled: (flags) => flags.canCopy,
  },
  {
    key: 'paste',
    label: 'Paste',
    testId: 'global-context-paste',
    Icon: ClipboardText,
    action: runPaste,
    isEnabled: (flags) => flags.canPaste,
  },
]

function useDismissAllListener(closeMenu: () => void) {
  useEffect(() => {
    document.addEventListener(DISMISS_ALL_CONTEXT_MENUS, closeMenu)
    return () => {
      document.removeEventListener(DISMISS_ALL_CONTEXT_MENUS, closeMenu)
    }
  }, [closeMenu])
}

function openStateForContextMenu(event: MouseEvent): OpenState | null {
  if (isInsideDisabledTextControl(event.target)) {
    event.stopPropagation()
    return null
  }

  const field = resolveEditableFieldFromTarget(event.target)
  if (!field) {
    return null
  }

  event.stopPropagation()
  dispatchDismissAll()

  return {
    x: event.clientX,
    y: event.clientY,
    field: field,
    portalRoot: getContextMenuPortalRoot(field),
    textSelection: currentTextSelection(field),
  }
}

function useEditableFieldContextMenu(setOpen: (open: OpenState) => void) {
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      const nextOpen = openStateForContextMenu(event)
      if (nextOpen) setOpen(nextOpen)
    }

    document.addEventListener('contextmenu', onContextMenu, true)
    return () => {
      document.removeEventListener('contextmenu', onContextMenu, true)
    }
  }, [setOpen])
}

function runMenuAction(action: () => Promise<void>, closeMenu: () => void) {
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
  useContextMenuPlacement(menuRef, open)
  useDismissAllListener(closeMenu)
  useEditableFieldContextMenu(setOpen)

  if (!open) {
    return null
  }

  const flags = menuFlags(open.field, open.textSelection)

  return createPortal(
    <div
      ref={menuRef}
      className={CONTEXT_MENU}
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
      {MENU_ITEMS.map(({ key, label, testId, Icon, action, isEnabled }) => (
        <button
          key={key}
          type="button"
          className={contextMenuItemClassName(false)}
          role="menuitem"
          disabled={!isEnabled(flags)}
          data-testid={testId}
          onClick={() => {
            runMenuAction(() => action(open.field, open.textSelection), closeMenu)
          }}
        >
          <Icon className={CONTEXT_MENU_ICON} size={MENU_ICON_SIZE} weight="regular" aria-hidden />
          <span>{label}</span>
        </button>
      ))}
    </div>,
    open.portalRoot
  )
}
