import { Table, Rows, Code } from '@phosphor-icons/react'
import type { ViewModeGroupProps, ViewMode } from '../../../types/shared-data-view'
import { Button } from '../../common/Button'
import { joinClassNames } from '../../../lib/class-names'
import { dataFlag } from '../../../lib/data-attributes'
import { FOCUS_RING } from '../../../lib/focus-ring'

type ViewModeButtonState = 'idle' | 'active'

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

const VIEW_MODE_BUTTON_FRAME =
  'inline-flex h-6.5 min-w-7.5 cursor-default items-center justify-center gap-1.5 rounded-bar px-2 text-size-row'

const VIEW_MODE_BUTTON_CLASSES: Record<ViewModeButtonState, string> = {
  idle: joinClassNames([
    VIEW_MODE_BUTTON_FRAME,
    FOCUS_RING,
    'bg-transparent text-light-on-surface-variant hover:bg-light-fill-subtle-hover hover:text-light-on-surface dark:text-dark-on-surface-variant dark:hover:bg-dark-fill-subtle-hover dark:hover:text-dark-on-surface',
  ]),
  active: joinClassNames([
    VIEW_MODE_BUTTON_FRAME,
    FOCUS_RING,
    'bg-light-primary font-semibold text-light-on-primary dark:bg-dark-primary dark:text-dark-on-primary',
  ]),
}

function viewModeButtonState(isActive: boolean): ViewModeButtonState {
  if (isActive) return 'active'
  return 'idle'
}

export function ViewModeGroup({
  currentMode,
  availableModes,
  onModeChange,
  testIdPrefix,
}: ViewModeGroupProps) {
  const prefix = testIdPrefix || 'view-mode'

  return (
    <div
      className="inline-flex shrink-0 items-center gap-0.5 rounded-control border border-light-stroke-control bg-light-fill-control p-0.5 dark:border-dark-stroke-control dark:bg-dark-fill-control"
      data-testid={`${prefix}-group`}
    >
      {availableModes.map((mode) => {
        const Icon = MODE_ICONS[mode]
        const isActive = currentMode === mode
        return (
          <Button
            variant="bare"
            key={mode}
            className={VIEW_MODE_BUTTON_CLASSES[viewModeButtonState(isActive)]}
            onClick={() => onModeChange(mode)}
            title={MODE_LABELS[mode]}
            data-active={dataFlag(isActive)}
            data-testid={`${prefix}-${mode}`}
          >
            <Icon size={16} weight={isActive ? 'fill' : 'regular'} />
          </Button>
        )
      })}
    </div>
  )
}
