import { useCallback, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { Button } from './Button'
import { TabContextMenu, type TabContextMenuItem } from '../shared/TabContextMenu'
import { getContextMenuPortalRoot } from '../../lib/context-menu-utils'

interface MenuAnchor {
  x: number
  y: number
  portalRoot: HTMLElement
}

export interface SplitButtonProps {
  children: ReactNode
  onClick: () => void
  disabled: boolean
  menuLabel: string
  menuItems: TabContextMenuItem[]
  testId: string
}

function anchorBelow(trigger: HTMLElement): MenuAnchor {
  const bounds = trigger.getBoundingClientRect()
  return { x: bounds.left, y: bounds.bottom, portalRoot: getContextMenuPortalRoot(trigger) }
}

function useAnchoredMenu() {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null)
  const isMenuOpen = menuAnchor !== null

  const closeMenu = useCallback(() => {
    setMenuAnchor(null)
    triggerRef.current?.focus()
  }, [])

  function toggleMenu(event: MouseEvent<HTMLButtonElement>) {
    if (isMenuOpen) {
      closeMenu()
      return
    }
    setMenuAnchor(anchorBelow(event.currentTarget))
  }

  function keepOpenMenuFromOutsideDismiss(event: MouseEvent<HTMLButtonElement>) {
    if (isMenuOpen) event.stopPropagation()
  }

  return {
    triggerRef,
    menuAnchor,
    isMenuOpen,
    closeMenu,
    toggleMenu,
    keepOpenMenuFromOutsideDismiss,
  }
}

export function SplitButton({
  children,
  onClick,
  disabled,
  menuLabel,
  menuItems,
  testId,
}: SplitButtonProps) {
  const {
    triggerRef,
    menuAnchor,
    isMenuOpen,
    closeMenu,
    toggleMenu,
    keepOpenMenuFromOutsideDismiss,
  } = useAnchoredMenu()

  return (
    <div className="flex">
      <Button
        variant="accent"
        segment="start"
        onClick={onClick}
        disabled={disabled}
        data-testid={testId}
      >
        {children}
      </Button>
      <Button
        ref={triggerRef}
        variant="accent"
        segment="end"
        size="menuTrigger"
        iconOnly
        className="aria-expanded:bg-light-primary-pressed dark:aria-expanded:bg-dark-primary-pressed"
        aria-label={menuLabel}
        title={menuLabel}
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        disabled={disabled}
        onMouseDown={keepOpenMenuFromOutsideDismiss}
        onClick={toggleMenu}
        data-testid={`${testId}-menu-trigger`}
      >
        <CaretDown size={16} weight="regular" />
      </Button>
      {menuAnchor ? (
        <TabContextMenu
          visible
          x={menuAnchor.x}
          y={menuAnchor.y}
          portalRoot={menuAnchor.portalRoot}
          items={menuItems}
          onClose={closeMenu}
          testId={`${testId}-menu`}
        />
      ) : null}
    </div>
  )
}
