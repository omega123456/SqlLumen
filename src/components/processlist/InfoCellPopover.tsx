import { useRef, useMemo, useCallback } from 'react'
import { Copy } from '@phosphor-icons/react'
import { IconButton } from '../common/IconButton'
import { ElevatedCodePanel } from '../common/ElevatedCodePanel'
import { writeClipboardText } from '../../lib/context-menu-utils'
import { showErrorToast, showSuccessToast } from '../../stores/toast-store'
import { useDismissOnOutsideClick } from '../connection-dialog/useDismissOnOutsideClick'
import { toErrorMessage } from '../../lib/error-message'

const ANCHOR_GAP_PX = 4
const VIEWPORT_MARGIN_PX = 8
const APPROXIMATE_POPOVER_WIDTH_PX = 480
const APPROXIMATE_POPOVER_HEIGHT_PX = 320

export interface InfoCellPopoverProps {
  sql: string | null
  anchorEl?: HTMLElement | null
  anchorRect?: DOMRect | null
  onClose: () => void
}

export function InfoCellPopover({ sql, anchorEl, anchorRect, onClose }: InfoCellPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)

  const position = useMemo(() => {
    const rect = anchorRect ?? anchorEl?.getBoundingClientRect()
    if (!rect) return { top: 0, left: 0 }
    let top = rect.bottom + ANCHOR_GAP_PX
    let left = rect.left
    const viewportHeight = window.innerHeight
    if (top + APPROXIMATE_POPOVER_HEIGHT_PX > viewportHeight - VIEWPORT_MARGIN_PX) {
      top = rect.top - APPROXIMATE_POPOVER_HEIGHT_PX - ANCHOR_GAP_PX
    }
    if (left + APPROXIMATE_POPOVER_WIDTH_PX > window.innerWidth - VIEWPORT_MARGIN_PX) {
      left = window.innerWidth - VIEWPORT_MARGIN_PX - APPROXIMATE_POPOVER_WIDTH_PX
    }
    return { top: Math.max(VIEWPORT_MARGIN_PX, top), left: Math.max(VIEWPORT_MARGIN_PX, left) }
  }, [anchorEl, anchorRect])

  const isOpen = (anchorEl != null || anchorRect != null) && sql != null
  useDismissOnOutsideClick({
    ref: popoverRef,
    active: isOpen,
    onDismiss: onClose,
    options: { closeOnEscape: true },
  })

  const handleCopy = useCallback(async () => {
    if (!sql) return

    try {
      await writeClipboardText(sql)
      showSuccessToast('Copied to clipboard')
    } catch (error) {
      showErrorToast('Copy failed', toErrorMessage(error))
    }
  }, [sql])

  if (!isOpen) return null
  if (!sql) return null

  return (
    <div
      ref={popoverRef}
      className="fixed z-1001 flex max-h-80 max-w-120 flex-col overflow-hidden rounded-overlay border border-light-stroke-flyout bg-light-surface-container-high shadow-light-flyout dark:border-dark-stroke-flyout dark:bg-dark-surface-container-high dark:shadow-dark-flyout"
      style={{ top: position.top, left: position.left }}
      data-testid="info-cell-popover"
    >
      <ElevatedCodePanel
        label="SQL / info"
        headerActions={
          <IconButton
            aria-label="Copy SQL"
            onClick={() => void handleCopy()}
            data-testid="info-popover-copy"
            size="sm"
          >
            <Copy size={14} />
          </IconButton>
        }
      >
        {sql}
      </ElevatedCodePanel>
    </div>
  )
}
