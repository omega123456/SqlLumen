import { Stack, XCircle } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { ObjectTypeIcon } from '../shared/ObjectTypeIcon'
import type { PaletteResultType } from '../../types/schema'
import type { CommandPaletteFilterPillValue } from './palette-types'
import { joinClassNames } from '../../lib/class-names'
import { FOCUS_RING } from '../../lib/focus-ring'

export interface CommandPaletteFilterPillProps {
  pill: CommandPaletteFilterPillValue
  onRemove: () => void
}

export function CommandPaletteFilterPill({ pill, onRemove }: CommandPaletteFilterPillProps) {
  const hasObjectTypeIcon = pill.kind === 'object-type' || pill.kind === 'table'
  return (
    <span
      className="inline-flex flex-none items-center gap-1 bg-transparent p-0 font-body text-palette-input font-semibold text-light-primary dark:text-dark-primary"
      data-testid={`command-palette-pill-${pill.kind === 'object-type' ? 'type' : pill.kind}`}
    >
      <span className="inline-flex shrink-0 items-center justify-center" aria-hidden="true">
        {hasObjectTypeIcon ? (
          <ObjectTypeIcon
            objectType={(pill.kind === 'table' ? 'table' : pill.value) as PaletteResultType}
            size={14}
            weight="fill"
          />
        ) : (
          <Stack size={14} weight="fill" />
        )}
      </span>
      <span className="whitespace-nowrap">{pill.label}</span>
      <Button
        variant="bare"
        className={joinClassNames([
          'inline-flex size-3.5 min-w-3.5 cursor-default items-center justify-center gap-1.5 rounded-pill bg-transparent p-0 font-body text-size-row leading-5 font-regular whitespace-nowrap text-light-on-surface-variant opacity-50 hover:text-light-error hover:opacity-100 focus-visible:text-light-error focus-visible:opacity-100 dark:text-dark-on-surface-variant dark:hover:text-dark-error dark:focus-visible:text-dark-error',
          FOCUS_RING,
        ])}
        onClick={onRemove}
        aria-label={`Remove ${pill.label} filter`}
      >
        <XCircle size={14} weight="fill" />
      </Button>
    </span>
  )
}
