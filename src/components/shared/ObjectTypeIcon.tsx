import {
  Columns,
  Eye,
  Gear,
  Lightning,
  MathOperations,
  Table,
  type IconProps,
} from '@phosphor-icons/react'
import type { PaletteResultType } from '../../types/schema'
import styles from './ObjectTypeIcon.module.css'

export interface ObjectTypeIconProps {
  objectType: PaletteResultType
  size?: number
  weight?: IconProps['weight']
  className?: string
}

const ICONS: Record<PaletteResultType, typeof Table> = {
  table: Table,
  column: Columns,
  view: Eye,
  procedure: Gear,
  function: MathOperations,
  trigger: Lightning,
}

const TYPE_CLASS_NAMES: Record<PaletteResultType, string> = {
  table: styles.table,
  column: styles.column,
  view: styles.view,
  procedure: styles.procedure,
  function: styles.function,
  trigger: styles.trigger,
}

function getTypeClassName(objectType: PaletteResultType): string {
  return TYPE_CLASS_NAMES[objectType]
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
