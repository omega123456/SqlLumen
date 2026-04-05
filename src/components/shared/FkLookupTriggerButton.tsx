/**
 * FkLookupTriggerButton — shared trigger button for opening the FK lookup dialog.
 *
 * Used by both FkCellRenderer (read-mode overlay) and the cell editors
 * (NullableCellEditor / EnumCellEditor) in edit-mode. The visual differences
 * between renderer and editor usage are handled via the `className` prop.
 *
 * The button carries `data-fk-trigger=""` for CSS attribute selectors and
 * `data-testid="fk-lookup-trigger"` for tests.
 */

import { DotsThree } from '@phosphor-icons/react'
import { useFkLookup } from './fk-lookup-context'
import type { ForeignKeyColumnInfo } from '../../types/schema'

interface FkLookupTriggerButtonProps {
  foreignKey: ForeignKeyColumnInfo
  columnKey: string
  currentValue: unknown
  rowData: Record<string, unknown>
  /** CSS class for the button */
  className: string
}

export function FkLookupTriggerButton({
  foreignKey,
  columnKey,
  currentValue,
  rowData,
  className,
}: FkLookupTriggerButtonProps) {
  const fkLookup = useFkLookup()

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    fkLookup?.onFkLookup({ columnKey, currentValue, foreignKey, rowData })
  }

  return (
    <button
      type="button"
      className={className}
      aria-label="Look up foreign key value (F4)"
      data-testid="fk-lookup-trigger"
      data-fk-trigger=""
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      <DotsThree size={14} />
    </button>
  )
}
