import { joinClassNames } from './class-names'
import { FOCUS_RING } from './focus-ring'

export type ListRowActionTone = 'neutral' | 'danger'

export const LIST_ROW =
  'group/row flex cursor-pointer border-b border-light-outline-variant transition-background duration-120 hover:bg-light-surface-container-high dark:border-dark-outline-variant dark:hover:bg-dark-surface-container-high'

export const LIST_ROW_ACTIONS =
  'flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-120 group-hover/row:opacity-100'

const LIST_ROW_ACTION_BUTTON_FRAME =
  'inline-flex size-6 cursor-pointer items-center justify-center rounded-control bg-transparent p-0 text-light-on-surface-variant transition-background-and-color duration-120 hover:bg-light-surface-container-highest dark:text-dark-on-surface-variant dark:hover:bg-dark-surface-container-highest'

const LIST_ROW_ACTION_TONE_CLASSES: Record<ListRowActionTone, string> = {
  neutral: 'hover:text-light-on-surface dark:hover:text-dark-on-surface',
  danger: 'hover:text-light-error dark:hover:text-dark-error',
}

export function listRowActionButtonClassName(tone: ListRowActionTone): string {
  return joinClassNames([
    LIST_ROW_ACTION_BUTTON_FRAME,
    FOCUS_RING,
    LIST_ROW_ACTION_TONE_CLASSES[tone],
  ])
}
