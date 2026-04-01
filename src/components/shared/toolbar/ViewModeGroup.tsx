/**
 * ViewModeGroup — shared toolbar component for toggling between view modes.
 *
 * Renders icon buttons for each available mode (grid / form / text).
 * Purely presentational — no store imports.
 */

import { Table, Rows, Code } from '@phosphor-icons/react'
import type { ViewModeGroupProps, ViewMode } from '../../../types/shared-data-view'
import styles from './toolbar-items.module.css'

const MODE_ICONS: Record<ViewMode, typeof Table> = {
  grid: Table,
  form: Rows,
  text: Code,
}

const MODE_LABELS: Record<ViewMode, string> = {
  grid: 'Grid view',
  form: 'Form view',
  text: 'Text view',
}

export function ViewModeGroup({
  currentMode,
  availableModes,
  onModeChange,
  testIdPrefix,
}: ViewModeGroupProps) {
  const prefix = testIdPrefix || 'view-mode'

  return (
    <div className={styles.viewModeGroup} data-testid={`${prefix}-group`}>
      {availableModes.map((mode) => {
        const Icon = MODE_ICONS[mode]
        const isActive = currentMode === mode
        return (
          <button
            key={mode}
            type="button"
            className={`${styles.viewModeButton} ${isActive ? styles.viewModeActive : ''}`}
            onClick={() => onModeChange(mode)}
            title={MODE_LABELS[mode]}
            data-testid={`${prefix}-${mode}`}
          >
            <Icon size={14} weight={isActive ? 'fill' : 'regular'} />
          </button>
        )
      })}
    </div>
  )
}
