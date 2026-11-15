import type { MouseEvent as ReactMouseEvent } from 'react'
import { Button } from '../../common/Button'
import { joinClassNames } from '../../../lib/class-names'
import { dataFlag } from '../../../lib/data-attributes'
import { FOCUS_RING } from '../../../lib/focus-ring'

type NullToggleState = 'idle' | 'active'

const NULL_TOGGLE_FRAME =
  'flex shrink-0 cursor-pointer items-center justify-center self-center h-4.5 px-1.5 rounded-control border font-mono text-size-caption font-semibold leading-flat whitespace-nowrap'

const NULL_TOGGLE_CLASSES: Record<NullToggleState, string> = {
  idle: joinClassNames([
    NULL_TOGGLE_FRAME,
    FOCUS_RING,
    'bg-transparent border-light-stroke-divider text-light-outline hover:bg-light-fill-subtle-hover hover:border-light-primary hover:text-light-primary dark:border-dark-stroke-divider dark:text-dark-outline dark:hover:bg-dark-fill-subtle-hover dark:hover:border-dark-primary dark:hover:text-dark-primary',
  ]),
  active: joinClassNames([
    NULL_TOGGLE_FRAME,
    FOCUS_RING,
    'bg-light-fill-accent-tint border-light-primary text-light-primary dark:bg-dark-fill-accent-tint dark:border-dark-primary dark:text-dark-primary',
  ]),
}

interface NullToggleButtonProps {
  isNull: boolean
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void
  onMouseDown?: (event: ReactMouseEvent<HTMLButtonElement>) => void
  className?: string
}

function preventFocusSteal(event: ReactMouseEvent<HTMLButtonElement>): void {
  event.preventDefault()
}

function nullToggleState(isNull: boolean): NullToggleState {
  if (isNull) return 'active'
  return 'idle'
}

export function NullToggleButton({
  isNull,
  onClick,
  onMouseDown = preventFocusSteal,
  className,
}: NullToggleButtonProps) {
  return (
    <Button
      variant="bare"
      className={joinClassNames([NULL_TOGGLE_CLASSES[nullToggleState(isNull)], className])}
      data-null-toggle=""
      data-active={dataFlag(isNull)}
      onMouseDown={onMouseDown}
      onClick={onClick}
      tabIndex={-1}
    >
      NULL
    </Button>
  )
}
