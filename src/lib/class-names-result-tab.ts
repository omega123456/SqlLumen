export type ResultTabActivity = 'idle' | 'active'

export const RESULT_TAB_FRAME =
  'relative flex shrink-0 items-center gap-2 h-full bg-transparent font-body text-row whitespace-nowrap cursor-default'

export const RESULT_TAB_ACTIVITY_CLASSES: Record<ResultTabActivity, string> = {
  idle: 'font-regular text-light-on-surface-variant dark:text-dark-on-surface-variant hover:text-light-on-surface dark:hover:text-dark-on-surface',
  active:
    'font-semibold text-light-on-surface dark:text-dark-on-surface after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-t-track after:bg-light-primary dark:after:bg-dark-primary',
}

export function resultTabActivityOf(isActive: boolean): ResultTabActivity {
  if (isActive) return 'active'
  return 'idle'
}
