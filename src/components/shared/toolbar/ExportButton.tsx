import { Export } from '@phosphor-icons/react'
import type { ExportButtonProps } from '../../../types/shared-data-view'
import { Button } from '../../common/Button'

export function ExportButton({ disabled, onClick, testId }: ExportButtonProps) {
  return (
    <Button
      variant="subtle"
      size="sm"
      className="shrink-0"
      disabled={disabled}
      onClick={onClick}
      data-testid={testId || 'btn-export'}
    >
      <Export size={16} weight="regular" />
      <span>Export</span>
    </Button>
  )
}
