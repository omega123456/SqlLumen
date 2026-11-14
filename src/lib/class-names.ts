const CLASS_NAME_SEPARATOR = ' '

export const SCROLLBAR =
  'webkit-scrollbar:w-2 webkit-scrollbar-track:bg-transparent webkit-scrollbar-thumb:rounded-control webkit-scrollbar-thumb:bg-light-text-disabled dark:webkit-scrollbar-thumb:bg-dark-text-disabled webkit-scrollbar-thumb-hover:bg-light-outline dark:webkit-scrollbar-thumb-hover:bg-dark-outline'

export const ELEVATED_SURFACE =
  'rounded-card bg-light-surface-container-high dark:bg-dark-surface-container-high shadow-light-elevated dark:shadow-dark-elevated'

export function joinClassNames(classNames: ReadonlyArray<string | undefined>): string {
  return classNames.filter(Boolean).join(CLASS_NAME_SEPARATOR)
}
