import {
  Columns,
  Eye,
  Gear,
  Lightning,
  MathOperations,
  Table,
  type IconProps,
} from '@phosphor-icons/react'
import { joinClassNames } from '../../lib/class-names'
import type { PaletteResultType } from '../../types/schema'

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
  table: 'text-light-primary dark:text-dark-primary',
  column: 'text-light-primary dark:text-dark-primary',
  view: 'text-light-secondary dark:text-dark-secondary',
  procedure: 'text-light-on-surface-variant dark:text-dark-on-surface-variant',
  function: 'text-light-tertiary dark:text-dark-tertiary',
  trigger: 'text-light-warning dark:text-dark-warning',
}

export function ObjectTypeIcon({
  objectType,
  size = 16,
  weight = 'regular',
  className,
}: ObjectTypeIconProps) {
  const Icon = ICONS[objectType]

  return (
    <span
      className={joinClassNames([
        'inline-flex shrink-0 items-center justify-center',
        TYPE_CLASS_NAMES[objectType],
        className,
      ])}
      data-testid={`object-type-icon-${objectType}`}
      aria-hidden="true"
    >
      <Icon size={size} weight={weight} />
    </span>
  )
}
