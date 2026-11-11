/**
 * ExportButton — shared toolbar component for triggering data export.
 *
 * Renders a button with an Export icon and "Export" label.
 * Purely presentational — no store imports.
 */

import { Export } from '@phosphor-icons/react'
import type { ExportButtonProps } from '../../../types/shared-data-view'
import { Button } from '../../common/Button'
import styles from './toolbar-items.module.css'

export function ExportButton({ disabled, onClick, testId }: ExportButtonProps) {
  return (
    <Button
      variant="bare"
      className={styles.exportButton}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId || 'btn-export'}
    >
      <Export size={16} weight="regular" />
      <span>Export</span>
    </Button>
  )
}
