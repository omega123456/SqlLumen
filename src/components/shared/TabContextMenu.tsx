import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { useDismissOnOutsideClick } from '../connection-dialog/useDismissOnOutsideClick'
import { DISMISS_ALL_CONTEXT_MENUS } from '../../lib/context-menu-events'
import { positionContextMenuInPortal } from '../../lib/context-menu-utils'

export interface TabContextMenuItem {
  key: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  destructive?: boolean
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

export function TabContextMenu({ visible, x, y, portalRoot, items, onClose }: TabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  const closeMenu = useCallback(() => {
    onClose()
  }, [onClose])

  useDismissOnOutsideClick(menuRef, visible, closeMenu, { closeOnEscape: true })

  useEffect(() => {
    if (!visible) return
    const onDismissAll = () => closeMenu()
    document.addEventListener(DISMISS_ALL_CONTEXT_MENUS, onDismissAll)
    return () => {
      document.removeEventListener(DISMISS_ALL_CONTEXT_MENUS, onDismissAll)
    }
  }, [visible, closeMenu])

  useLayoutEffect(() => {
    if (!visible || !menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const pos = positionContextMenuInPortal(portalRoot, x, y, rect.width, rect.height)
    menuRef.current.style.left = `${pos.x}px`
    menuRef.current.style.top = `${pos.y}px`
  }, [visible, x, y, portalRoot])

  if (!visible || items.length === 0) {
    return null
  }

  return createPortal(
    <div
      ref={menuRef}
      className="ui-context-menu"
      role="menu"
      style={{ left: x, top: y }}
      data-testid="tab-context-menu"
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item) => {
        const itemClass = [
          'ui-context-menu__item',
          item.destructive ? 'ui-context-menu__item--destructive' : '',
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className={itemClass}
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
          </button>
        )
      })}
    </div>,
    portalRoot
  )
}
