import { Eye, Gear, Lightning, MathOperations, Table, type IconProps } from '@phosphor-icons/react'
import type { PaletteTypeFilter } from '../../types/schema'
import styles from './ObjectTypeIcon.module.css'

export interface ObjectTypeIconProps {
  objectType: PaletteTypeFilter
  size?: number
  weight?: IconProps['weight']
  className?: string
}

const ICONS: Record<PaletteTypeFilter, typeof Table> = {
  table: Table,
  view: Eye,
  procedure: Gear,
  function: MathOperations,
  trigger: Lightning,
}

function getTypeClassName(objectType: PaletteTypeFilter): string {
  switch (objectType) {
    case 'table':
      return styles.table
    case 'view':
      return styles.view
    case 'procedure':
      return styles.procedure
    case 'function':
      return styles.function
    case 'trigger':
      return styles.trigger
  }
}

export function ObjectTypeIcon({
  objectType,
  size = 16,
  weight = 'regular',
  className,
}: ObjectTypeIconProps) {
  const Icon = ICONS[objectType]
  const mergedClassName = [styles.icon, getTypeClassName(objectType), className]
    .filter(Boolean)
    .join(' ')

  return (
    <span
      className={mergedClassName}
      data-testid={`object-type-icon-${objectType}`}
      aria-hidden="true"
    >
      <Icon size={size} weight={weight} />
    </span>
  )
}
