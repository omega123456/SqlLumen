import { joinClassNames, SCROLLBAR } from './class-names'

export const LIST_PANEL_TOOLBAR =
  'flex shrink-0 items-center gap-2 border-b border-light-outline-variant px-3 py-2 dark:border-dark-outline-variant'

export const LIST_PANEL_LIST = joinClassNames(['flex-1 overflow-y-auto py-2', SCROLLBAR])

export const LIST_PANEL_EMPTY_STATE =
  'flex h-full items-center justify-center text-size-body text-light-on-surface-variant dark:text-dark-on-surface-variant'

export const LIST_PANEL_ERROR_STATE =
  'flex h-full flex-col items-center justify-center gap-2 p-3 text-center'

export const LIST_PANEL_ERROR_MESSAGE = 'text-size-caption text-light-error dark:text-dark-error'
