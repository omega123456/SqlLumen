import { joinClassNames } from './class-names'

export const TILE = 'grid size-8 shrink-0 place-items-center rounded-control'

export const ACCENT_TILE = joinClassNames([
  TILE,
  'bg-light-fill-accent-tint text-light-primary dark:bg-dark-fill-accent-tint dark:text-dark-primary',
])
