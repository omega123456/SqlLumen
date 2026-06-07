import { Stack, XCircle } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { ObjectTypeIcon } from '../shared/ObjectTypeIcon'
import type { PaletteTypeFilter } from '../../types/schema'
import type { CommandPaletteFilterPillValue } from './CommandPalette'
import styles from './CommandPaletteInput.module.css'

export interface CommandPaletteFilterPillProps {
  pill: CommandPaletteFilterPillValue
  onRemove: () => void
}

export function CommandPaletteFilterPill({ pill, onRemove }: CommandPaletteFilterPillProps) {
  return (
    <span
      className={styles.pill}
      data-testid={`command-palette-pill-${pill.kind === 'object-type' ? 'type' : pill.kind}`}
    >
      <span className={styles.pillIcon} aria-hidden="true">
        {pill.kind === 'object-type' ? (
          <ObjectTypeIcon objectType={pill.value as PaletteTypeFilter} size={14} weight="fill" />
        ) : (
          <Stack size={14} weight="fill" />
        )}
      </span>
      <span className={styles.pillLabel}>{pill.label}</span>
      <Button
        variant="ghost"
        className={styles.pillRemove}
        onClick={onRemove}
        aria-label={`Remove ${pill.label} filter`}
      >
        <XCircle size={14} weight="fill" />
      </Button>
    </span>
  )
}
