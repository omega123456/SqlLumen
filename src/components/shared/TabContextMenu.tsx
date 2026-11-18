import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { useDismissOnOutsideClick } from '../../hooks/use-dismiss-on-outside-click'
import { DISMISS_ALL_CONTEXT_MENUS } from '../../lib/context-menu-events'
import {
  CONTEXT_MENU,
  CONTEXT_MENU_SEPARATOR,
  contextMenuItemClassName,
} from '../../lib/class-names-menu'
import { dataFlag } from '../../lib/data-attributes'
import { getContextMenuPositionMode } from '../../lib/context-menu-utils'
import { useContextMenuPlacement } from '../../hooks/use-context-menu-placement'
import { Button } from '../common/Button'

export interface TabContextMenuItem {
  key: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  destructive?: boolean
  shortcut?: string
  separatorAfter?: boolean
  onSelect: () => void
}

export interface TabContextMenuProps {
  visible: boolean
  x: number
  y: number
  portalRoot: HTMLElement
  items: TabContextMenuItem[]
  onClose: () => void
  testId?: string
}

function TabContextMenuEntry({
  item,
  closeMenu,
  testId,
}: {
  item: TabContextMenuItem
  closeMenu: () => void
  testId: string
}) {
  const button = (
    <Button
      variant="bare"
      role="menuitem"
      className={contextMenuItemClassName(item.destructive)}
      data-destructive={dataFlag(item.destructive)}
      disabled={item.disabled}
      data-testid={`${testId}-item-${item.key}`}
      onClick={() => {
        if (item.disabled) {
          return
        }
        item.onSelect()
        closeMenu()
      }}
    >
      {item.icon ? (
        <span className="shrink-0" aria-hidden>
          {item.icon}
        </span>
      ) : null}
      <span>{item.label}</span>
      {item.shortcut ? (
        <span
          className="ml-auto pl-6 text-caption text-light-on-surface-variant dark:text-dark-on-surface-variant group-disabled:text-inherit"
          aria-hidden
        >
          {item.shortcut}
        </span>
      ) : null}
    </Button>
  )
  if (!item.separatorAfter) {
    return button
  }
  return (
    <>
      {button}
      <hr className={CONTEXT_MENU_SEPARATOR} />
    </>
  )
}

function useDismissAllWhileVisible(visible: boolean, closeMenu: () => void) {
  useEffect(() => {
    if (!visible) return
    const onDismissAll = () => closeMenu()
    document.addEventListener(DISMISS_ALL_CONTEXT_MENUS, onDismissAll)
    return () => {
      document.removeEventListener(DISMISS_ALL_CONTEXT_MENUS, onDismissAll)
    }
  }, [visible, closeMenu])
}

export function TabContextMenu({
  visible,
  x,
  y,
  portalRoot,
  items,
  onClose,
  testId = 'tab-context-menu',
}: TabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  const closeMenu = useCallback(() => {
    onClose()
  }, [onClose])

  useDismissOnOutsideClick({
    ref: menuRef,
    active: visible,
    onDismiss: closeMenu,
    options: { closeOnEscape: true },
  })
  useDismissAllWhileVisible(visible, closeMenu)
  useContextMenuPlacement(menuRef, visible ? { x: x, y: y, portalRoot: portalRoot } : null)

  if (!visible) return null
  if (items.length === 0) return null

  return createPortal(
    <div
      ref={menuRef}
      className={CONTEXT_MENU}
      role="menu"
      style={{
        left: x,
        top: y,
        position: getContextMenuPositionMode(portalRoot),
      }}
      data-testid={testId}
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <TabContextMenuEntry key={item.key} item={item} closeMenu={closeMenu} testId={testId} />
      ))}
    </div>,
    portalRoot
  )
}
