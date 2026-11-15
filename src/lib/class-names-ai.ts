import { joinClassNames, SCROLLBAR } from './class-names'

export const AI_COMPOSER_POPUP = joinClassNames([
  'absolute bottom-full left-0 z-10 mb-1 max-h-60 w-full animate-fade-in overflow-y-auto rounded-overlay bg-light-surface-container-high py-2 shadow-light-flyout window-blurred:animate-fade-in-paused dark:bg-dark-surface-container-high dark:shadow-dark-flyout',
  SCROLLBAR,
])
