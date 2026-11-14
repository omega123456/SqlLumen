import { joinClassNames } from '../../../lib/class-names'
import type { UnderlineTabRowHeight, UnderlineTabVariant } from './tab-bar-variants'

type BarShape = 'standalone' | 'wrapper' | 'wrapped'
type EdgeZone = 'start' | 'end'

const ROW_HEIGHT_CLASSES: Record<UnderlineTabRowHeight, string> = {
  default: 'h-tab-strip',
  tall: 'h-title-strip',
}

const BAR_SHAPE_CLASSES: Record<BarShape, Record<UnderlineTabVariant, string>> = {
  standalone: {
    default:
      'flex flex-none w-full min-w-0 items-stretch gap-1 bg-transparent border-b border-b-light-stroke-divider dark:border-b-dark-stroke-divider',
    selector:
      'flex flex-none w-full min-w-0 items-stretch gap-0 bg-transparent shadow-light-divider-bottom dark:shadow-dark-divider-bottom',
    document:
      'flex flex-none w-full min-w-0 items-end gap-0.5 px-2 bg-light-surface-strip dark:bg-dark-surface-strip shadow-light-divider-bottom dark:shadow-dark-divider-bottom',
  },
  wrapper: {
    default:
      'flex shrink-0 w-full min-w-0 items-stretch bg-transparent border-b border-b-light-stroke-divider dark:border-b-dark-stroke-divider',
    selector:
      'flex shrink-0 w-full min-w-0 items-stretch gap-0 bg-transparent shadow-light-divider-bottom dark:shadow-dark-divider-bottom',
    document:
      'flex shrink-0 w-full min-w-0 items-end gap-0.5 px-2 bg-light-surface-strip dark:bg-dark-surface-strip shadow-light-divider-bottom dark:shadow-dark-divider-bottom',
  },
  wrapped: {
    default: 'flex grow basis-0 w-auto min-w-0 items-stretch gap-1 bg-transparent',
    selector: 'flex grow basis-0 w-auto min-w-0 items-stretch gap-0 bg-transparent',
    document: 'flex grow basis-0 w-auto min-w-0 items-end gap-0.5 bg-transparent',
  },
}

const BAR_CONTENT_CLASSES: Record<UnderlineTabVariant, string> = {
  default: 'items-stretch gap-1',
  selector: 'items-stretch gap-0',
  document: 'items-end gap-0.5',
}

const EDGE_ZONE_CLASSES: Record<EdgeZone, Record<UnderlineTabVariant, string>> = {
  start: {
    default:
      'absolute z-3 top-1.5 bottom-px left-0 flex items-end pr-1 pb-px bg-light-surface-container dark:bg-dark-surface-container shadow-light-strip-tint dark:shadow-dark-strip-tint border-r border-r-light-stroke-divider dark:border-r-dark-stroke-divider',
    selector:
      'absolute z-3 inset-y-0 left-0 flex items-center pr-1 bg-light-surface-container dark:bg-dark-surface-container border-r border-r-light-stroke-divider dark:border-r-dark-stroke-divider',
    document:
      'absolute z-3 top-1.5 bottom-px left-0 flex items-end pr-1 pb-px bg-light-surface-container dark:bg-dark-surface-container shadow-light-strip-tint dark:shadow-dark-strip-tint border-r border-r-light-stroke-divider dark:border-r-dark-stroke-divider',
  },
  end: {
    default:
      'flex flex-none self-stretch items-end mt-1.5 mb-px pb-px pl-1 border-l border-l-light-stroke-divider dark:border-l-dark-stroke-divider',
    selector:
      'flex flex-none self-stretch items-center pl-1 border-l border-l-light-stroke-divider dark:border-l-dark-stroke-divider',
    document:
      'flex flex-none self-stretch items-end mt-1.5 mb-px pb-px pl-1 border-l border-l-light-stroke-divider dark:border-l-dark-stroke-divider',
  },
}

const NATIVE_THIN_SCROLLBAR =
  'scrollbar-thin scrollbar-thumb-light-text-disabled dark:scrollbar-thumb-dark-text-disabled scrollbar-track-transparent scrollbar-thumb-rounded-control scrollbar-hover:scrollbar-thumb-light-outline dark:scrollbar-hover:scrollbar-thumb-dark-outline'

export interface TabBarShapeOptions {
  variant: UnderlineTabVariant
  rowHeight: UnderlineTabRowHeight
}

export interface TabBarClassOptions extends TabBarShapeOptions {
  className: string | undefined
}

export interface WrapperClassOptions {
  variant: UnderlineTabVariant
  className: string | undefined
}

export interface ScrollableViewportOptions extends TabBarShapeOptions {
  overflowing: boolean
}

export function standaloneBarClassName({
  variant,
  rowHeight,
  className,
}: TabBarClassOptions): string {
  return joinClassNames([
    BAR_SHAPE_CLASSES.standalone[variant],
    ROW_HEIGHT_CLASSES[rowHeight],
    'overflow-x-auto overflow-y-hidden',
    NATIVE_THIN_SCROLLBAR,
    className,
  ])
}

export function wrapperClassName({ variant, className }: WrapperClassOptions): string {
  return joinClassNames([BAR_SHAPE_CLASSES.wrapper[variant], className])
}

export function wrappedBarClassName({ variant, rowHeight }: TabBarShapeOptions): string {
  return joinClassNames([
    BAR_SHAPE_CLASSES.wrapped[variant],
    ROW_HEIGHT_CLASSES[rowHeight],
    'overflow-x-auto overflow-y-hidden',
    NATIVE_THIN_SCROLLBAR,
  ])
}

export function scrollableViewportClassName({
  variant,
  rowHeight,
  overflowing,
}: ScrollableViewportOptions): string {
  return joinClassNames([
    BAR_SHAPE_CLASSES.wrapped[variant],
    ROW_HEIGHT_CLASSES[rowHeight],
    'overflow-x-auto overflow-y-hidden scrollbar-none scrollbar-thumb-light-text-disabled dark:scrollbar-thumb-dark-text-disabled scrollbar-track-transparent',
    overflowing ? 'scroll-ps-13' : undefined,
  ])
}

export function barContentClassName({ variant, rowHeight }: TabBarShapeOptions): string {
  return joinClassNames([
    'flex shrink-0 w-max min-w-full',
    BAR_CONTENT_CLASSES[variant],
    ROW_HEIGHT_CLASSES[rowHeight],
  ])
}

export function barSuffixClassName(rowHeight: UnderlineTabRowHeight): string {
  return joinClassNames(['flex shrink-0 items-stretch self-start', ROW_HEIGHT_CLASSES[rowHeight]])
}

export function edgeZoneClassName(zone: EdgeZone, variant: UnderlineTabVariant): string {
  return EDGE_ZONE_CLASSES[zone][variant]
}
