import { useRef, useMemo, useCallback } from 'react'
import { Copy } from '@phosphor-icons/react'
import { IconButton } from '../common/IconButton'
import { ElevatedCodePanel } from '../common/ElevatedCodePanel'
import { writeClipboardText } from '../../lib/context-menu-utils'
import { showErrorToast, showSuccessToast } from '../../stores/toast-store'
import { useDismissOnOutsideClick } from '../connection-dialog/useDismissOnOutsideClick'
import styles from './InfoCellPopover.module.css'

export interface InfoCellPopoverProps {
  sql: string | null
  anchorEl: HTMLElement | null
  onClose: () => void
}

export function InfoCellPopover({ sql, anchorEl, onClose }: InfoCellPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)

  const position = useMemo(() => {
    if (!anchorEl) return { top: 0, left: 0 }
    const anchorRect = anchorEl.getBoundingClientRect()
    let top = anchorRect.bottom + 4
    let left = anchorRect.left
    // Approximate popover size for initial positioning; refined via CSS max-width/max-height
    const popoverWidth = 480
    const popoverHeight = 320
    const vh = window.innerHeight
    if (top + popoverHeight > vh - 8) {
      top = anchorRect.top - popoverHeight - 4
    }
    if (left + popoverWidth > window.innerWidth - 8) {
      left = window.innerWidth - 8 - popoverWidth
    }
    return { top: Math.max(8, top), left: Math.max(8, left) }
  }, [anchorEl])

  const isOpen = anchorEl != null && sql != null
  useDismissOnOutsideClick(popoverRef, isOpen, onClose, { closeOnEscape: true })

  const handleCopy = useCallback(async () => {
    if (!sql) return

    try {
      await writeClipboardText(sql)
      showSuccessToast('Copied to clipboard')
    } catch (error) {
      showErrorToast('Copy failed', error instanceof Error ? error.message : String(error))
    }
  }, [sql])

  if (!anchorEl || !sql) return null

  return (
    <div
      ref={popoverRef}
      className={styles.popover}
      style={{ top: position.top, left: position.left }}
      data-testid="info-cell-popover"
    >
      <ElevatedCodePanel
        label="SQL / Info"
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
