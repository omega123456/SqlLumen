import { ClipboardText } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import styles from './toolbar-items.module.css'

interface CopySelectedRowsButtonProps {
  disabled: boolean
  onClick: () => void
}

export function CopySelectedRowsButton({ disabled, onClick }: CopySelectedRowsButtonProps) {
  return (
    <Button
      variant="toolbar"
      className={styles.iconButton}
      disabled={disabled}
      onClick={onClick}
      aria-label="Copy selected rows to clipboard"
      title="Copy selected rows to clipboard"
      data-testid="btn-copy-selected-rows"
    >
      <ClipboardText size={16} weight="regular" />
    </Button>
  )
}
