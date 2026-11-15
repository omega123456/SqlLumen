import { joinClassNames } from './class-names'

export const SHIMMER_BLOCK =
  'relative overflow-hidden bg-light-fill-neutral-selected dark:bg-dark-fill-neutral-selected motion-safe:opacity-0 motion-safe:animate-skeleton-fade-in motion-safe:window-blurred:animate-skeleton-fade-in-paused motion-safe:after:absolute motion-safe:after:inset-0 motion-safe:after:bg-linear-90/srgb motion-safe:after:from-transparent motion-safe:after:via-light-fill-subtle-hover dark:motion-safe:after:via-dark-fill-subtle-hover motion-safe:after:to-transparent motion-safe:after:animate-shimmer-wave motion-safe:window-blurred:after:animate-shimmer-wave-paused'

export const SHIMMER_BLOCK_CONTROL = joinClassNames([SHIMMER_BLOCK, 'rounded-control'])
