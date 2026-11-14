import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { useDismissOnOutsideClick } from '../connection-dialog/useDismissOnOutsideClick'
import { DISMISS_ALL_CONTEXT_MENUS } from '../../lib/context-menu-events'
import { getContextMenuPositionMode } from '../../lib/context-menu-utils'
import { useContextMenuPlacement } from '../../hooks/use-context-menu-placement'
import { Button } from '../common/Button'

export interface TabContextMenuItem {
  key: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  destructive?: boolean
  /** Keyboard shortcut hint shown right-aligned (e.g. `⇧ F1`). */
  shortcut?: string
  /** Draw a separator below this item. */
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
}

function menuItemClassName(item: TabContextMenuItem): string {
  return ['ui-context-menu__item', item.destructive ? 'ui-context-menu__item--destructive' : '']
    .filter(Boolean)
    .join(' ')
}

function TabContextMenuEntry({
  item,
  closeMenu,
}: {
  item: TabContextMenuItem
  closeMenu: () => void
}) {
  const button = (
    <Button
      variant="bare"
      role="menuitem"
      className={menuItemClassName(item)}
      disabled={item.disabled}
      data-testid={`tab-context-menu-item-${item.key}`}
      onClick={() => {
        if (item.disabled) {
          return
        }
        item.onSelect()
        closeMenu()
      }}
    >
      {item.icon ? <span aria-hidden>{item.icon}</span> : null}
      <span>{item.label}</span>
      {item.shortcut ? (
        <span className="ui-context-menu__shortcut" aria-hidden>
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
      <hr className="ui-context-menu__separator" />
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

export function TabContextMenu({ visible, x, y, portalRoot, items, onClose }: TabContextMenuProps) {
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
      className="ui-context-menu"
      role="menu"
      style={{
        left: x,
        top: y,
        position: getContextMenuPositionMode(portalRoot),
      }}
      data-testid="tab-context-menu"
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <TabContextMenuEntry key={item.key} item={item} closeMenu={closeMenu} />
      ))}
    </div>,
    portalRoot
  )
}
