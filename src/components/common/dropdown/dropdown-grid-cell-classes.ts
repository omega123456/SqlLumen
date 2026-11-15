import { FOCUS_RING } from '../../../lib/focus-ring'
import { joinClassNames } from '../../../lib/class-names'
import type { DropdownPlacement } from './dropdown-types'

type OverlayTriggerState = 'closed' | 'openBelow' | 'openAbove'

const INLINE_TRIGGER_CLASSES = joinClassNames([
  'grow shrink basis-0 w-full max-w-full min-w-0 h-full min-h-5.5 px-1 py-0.5 rounded-control border-none bg-transparent font-regular font-mono text-size-mono leading-tight text-light-on-surface dark:text-dark-on-surface',
  FOCUS_RING,
])

const OVERLAY_FRAME =
  'grow shrink basis-0 w-full max-w-full min-w-0 h-full min-h-5.5 px-2.5 py-0 rounded-none bg-light-fill-control dark:bg-dark-fill-control font-body text-size-body leading-5 outline-none focus-visible:relative focus-visible:z-1'

const OVERLAY_CLOSED_CHROME =
  'border border-light-stroke-control dark:border-dark-stroke-control font-regular text-light-on-surface dark:text-dark-on-surface'

const OVERLAY_OPEN_CHROME =
  'border border-light-primary dark:border-dark-primary font-semibold text-light-primary dark:text-dark-primary'

const OVERLAY_STATE_CLASSES: Record<OverlayTriggerState, string> = {
  closed: joinClassNames([OVERLAY_FRAME, OVERLAY_CLOSED_CHROME]),
  openBelow: joinClassNames([OVERLAY_FRAME, OVERLAY_OPEN_CHROME, 'border-b-0']),
  openAbove: joinClassNames([OVERLAY_FRAME, OVERLAY_OPEN_CHROME, 'border-t-0']),
}

function overlayTriggerState(
  open: boolean,
  placement: DropdownPlacement | undefined
): OverlayTriggerState {
  if (!open) return 'closed'
  if (placement === 'top') return 'openAbove'
  return 'openBelow'
}

export function gridCellTriggerClassName(): string {
  return INLINE_TRIGGER_CLASSES
}

export function gridCellOverlayTriggerClassName(
  open: boolean,
  placement: DropdownPlacement | undefined
): string {
  return OVERLAY_STATE_CLASSES[overlayTriggerState(open, placement)]
}
