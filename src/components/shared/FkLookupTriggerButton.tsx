import { DotsThree } from '@phosphor-icons/react'
import { useFkLookup } from './fk-lookup-context'
import type { ForeignKeyColumnInfo } from '../../types/schema'
import { Button } from '../common/Button'

interface FkLookupTriggerButtonProps {
  foreignKey: ForeignKeyColumnInfo
  columnKey: string
  currentValue: unknown
  rowData: Record<string, unknown>
  className: string
  onBeforeLookup?: () => void
}

export function FkLookupTriggerButton({
  foreignKey,
  columnKey,
  currentValue,
  rowData,
  className,
  onBeforeLookup,
}: FkLookupTriggerButtonProps) {
  const foreignKeyLookup = useFkLookup()

  const handleMouseDown = (event: React.MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
  }

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation()
    onBeforeLookup?.()
    foreignKeyLookup?.onFkLookup({
      columnKey: columnKey,
      currentValue: currentValue,
      foreignKey: foreignKey,
      rowData: rowData,
      source: 'editor-trigger',
    })
  }

  return (
    <Button
      variant="bare"
      className={className}
      aria-label="Look up foreign key value (F4)"
      data-testid="fk-lookup-trigger"
      data-fk-trigger=""
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      <DotsThree size={14} />
    </Button>
  )
}
