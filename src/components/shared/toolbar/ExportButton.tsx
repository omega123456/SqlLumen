import { Export } from '@phosphor-icons/react'
import type { ExportButtonProps } from '../../../types/shared-data-view'
import { Button } from '../../common/Button'

export function ExportButton({ disabled, onClick, testId }: ExportButtonProps) {
  return (
    <Button
      variant="subtle"
      size="sm"
      className="shrink-0 @max-toolbar-compact:w-control-sm @max-toolbar-compact:px-0"
      disabled={disabled}
      onClick={onClick}
      title="Export"
      aria-label="Export"
      data-testid={testId || 'btn-export'}
    >
      <Export size={16} weight="regular" />
      <span className="@max-toolbar-compact:hidden">Export</span>
    </Button>
  )
}
