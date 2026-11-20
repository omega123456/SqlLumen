const CLASS_NAME_SEPARATOR = ' '

export const SCROLLBAR =
  'webkit-scrollbar:w-2 webkit-scrollbar-track:bg-transparent webkit-scrollbar-thumb:rounded-control webkit-scrollbar-thumb:bg-light-text-disabled dark:webkit-scrollbar-thumb:bg-dark-text-disabled webkit-scrollbar-thumb-hover:bg-light-outline dark:webkit-scrollbar-thumb-hover:bg-dark-outline'

export const SUBTLE_THIN_SCROLLBAR =
  'scrollbar-thin scrollbar-thumb-light-stroke-card dark:scrollbar-thumb-dark-stroke-card scrollbar-track-transparent'

export const PRIMARY_RING_SPINNER =
  'inline-block rounded-round border-2 border-light-primary-a30 border-t-light-primary animate-spin-700ms window-blurred:animate-spin-700ms-paused dark:border-dark-primary-a30 dark:border-t-dark-primary'

export const ELEVATED_SURFACE =
  'rounded-card bg-light-surface-container-high dark:bg-dark-surface-container-high shadow-light-elevated dark:shadow-dark-elevated'

export const DATA_VIEW_BAND_SLOT =
  'flex flex-none flex-col gap-2 border-t border-t-light-stroke-divider bg-light-surface-container-lowest p-3 dark:border-t-dark-stroke-divider dark:bg-dark-surface-container-lowest'

export function joinClassNames(classNames: ReadonlyArray<string | undefined>): string {
  return classNames.filter(Boolean).join(CLASS_NAME_SEPARATOR)
}
