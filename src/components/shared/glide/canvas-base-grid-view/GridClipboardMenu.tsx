import { createPortal } from 'react-dom'
import { ClipboardText, CopySimple, Scissors } from '@phosphor-icons/react'
import { getContextMenuPositionMode } from '../../../../lib/context-menu-utils'
import { Button } from '../../../common/Button'
import type { ClipboardMenuPosition } from './canvas-grid-types'

interface GridClipboardMenuProps {
  menu: ClipboardMenuPosition
  menuRef: React.RefObject<HTMLDivElement | null>
  testId: string | undefined
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
}

function clipboardMenuTestId(testId: string | undefined): string {
  return testId ? `${testId}-clipboard-menu` : 'grid-clipboard-menu'
}

export function GridClipboardMenu({
  menu,
  menuRef,
  testId,
  onCopy,
  onCut,
  onPaste,
}: GridClipboardMenuProps) {
  return createPortal(
    <div
      ref={menuRef}
      className="ui-context-menu"
      role="menu"
      data-testid={clipboardMenuTestId(testId)}
      style={{
        left: menu.x,
        top: menu.y,
        position: getContextMenuPositionMode(menu.portalRoot),
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Button variant="bare" className="ui-context-menu__item" role="menuitem" onClick={onCopy}>
        <CopySimple className="ui-context-menu__icon" size={18} weight="regular" aria-hidden />
        <span>Copy</span>
      </Button>
      <Button variant="bare" className="ui-context-menu__item" role="menuitem" onClick={onCut}>
        <Scissors className="ui-context-menu__icon" size={18} weight="regular" aria-hidden />
        <span>Cut</span>
      </Button>
      <Button variant="bare" className="ui-context-menu__item" role="menuitem" onClick={onPaste}>
        <ClipboardText className="ui-context-menu__icon" size={18} weight="regular" aria-hidden />
        <span>Paste</span>
      </Button>
    </div>,
    menu.portalRoot
  )
}
