import { joinClassNames } from '../../../lib/class-names'
import { FOCUS_RING } from '../../../lib/focus-ring'
import type { UnderlineTabVariant } from './tab-bar-variants'

export type TabShape = 'simple' | 'cell'
export type TabDropIndicator = 'before' | 'after'
type TabActivity = 'idle' | 'active'

const TAB_FOCUS_CLASSES: Record<TabShape, string> = {
  simple: FOCUS_RING,
  cell: '',
}

const TAB_SHAPE_CLASSES: Record<TabShape, Record<UnderlineTabVariant, string>> = {
  simple: {
    default: 'items-center px-3',
    selector: 'items-center px-4',
    document: 'items-center pr-1.5 pl-3',
  },
  cell: {
    default: 'items-stretch',
    selector: 'items-stretch',
    document: 'items-stretch',
  },
}

const TAB_FRAME_CLASSES: Record<UnderlineTabVariant, string> = {
  default: 'rounded-control text-body',
  selector: 'rounded-none text-body',
  document:
    'self-end h-tab min-w-37.5 border border-transparent border-b-0 rounded-t-overlay text-size-row leading-5',
}

const HOVER_FILL = 'hover:bg-light-fill-subtle-hover dark:hover:bg-dark-fill-subtle-hover'

const UNDERLINE_DEFAULT =
  'after:absolute after:bottom-0.5 after:left-1/2 after:-ml-2 after:h-0.75 after:w-4 after:rounded-track after:bg-light-primary dark:after:bg-dark-primary'

const UNDERLINE_SELECTOR =
  'after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-t-track after:bg-light-primary dark:after:bg-dark-primary'

const TAB_ACTIVITY_CLASSES: Record<UnderlineTabVariant, Record<TabActivity, string>> = {
  default: {
    idle: joinClassNames([
      'bg-transparent font-regular text-light-on-surface-variant dark:text-dark-on-surface-variant hover:text-light-on-surface dark:hover:text-dark-on-surface',
      HOVER_FILL,
    ]),
    active: joinClassNames([
      'bg-transparent font-semibold text-light-on-surface dark:text-dark-on-surface',
      HOVER_FILL,
      UNDERLINE_DEFAULT,
    ]),
  },
  selector: {
    idle: 'bg-transparent font-regular text-light-on-surface-variant dark:text-dark-on-surface-variant hover:text-light-on-surface dark:hover:text-dark-on-surface',
    active: joinClassNames([
      'bg-transparent font-semibold text-light-on-surface dark:text-dark-on-surface svg:text-light-primary dark:svg:text-dark-primary',
      UNDERLINE_SELECTOR,
    ]),
  },
  document: {
    idle: 'bg-transparent font-regular text-light-on-surface-variant dark:text-dark-on-surface-variant hover:text-light-on-surface dark:hover:text-dark-on-surface',
    active:
      'bg-light-surface-container dark:bg-dark-surface-container font-semibold text-light-on-surface dark:text-dark-on-surface',
  },
}

const DROP_INDICATOR_BASE =
  'before:absolute before:inset-y-2 before:z-1 before:w-0.5 before:rounded-track before:bg-light-primary dark:before:bg-dark-primary before:pointer-events-none'

const DROP_INDICATOR_CLASSES: Record<TabDropIndicator, string> = {
  before: joinClassNames([DROP_INDICATOR_BASE, 'before:left-0']),
  after: joinClassNames([DROP_INDICATOR_BASE, 'before:right-0']),
}

const LABEL_BUTTON_PADDING_CLASSES: Record<UnderlineTabVariant, string> = {
  default: 'px-3',
  selector: 'px-4',
  document: 'pl-3',
}

const SUFFIX_SLOT_CLASSES: Record<UnderlineTabVariant, string> = {
  default: 'pr-1.5',
  selector: 'pr-1.5',
  document: 'pr-1.5 pl-2',
}

function activityOf(isActive: boolean): TabActivity {
  if (isActive) return 'active'
  return 'idle'
}

export interface TabClassOptions {
  shape: TabShape
  variant: UnderlineTabVariant
  active: boolean
  dragging: boolean
  dropIndicator: TabDropIndicator | undefined
  className: string | undefined
}

export function tabClassName({
  shape,
  variant,
  active,
  dragging,
  dropIndicator,
  className,
}: TabClassOptions): string {
  return joinClassNames([
    'relative shrink-0 inline-flex gap-2 font-body whitespace-nowrap cursor-default',
    TAB_FOCUS_CLASSES[shape],
    TAB_SHAPE_CLASSES[shape][variant],
    TAB_FRAME_CLASSES[variant],
    TAB_ACTIVITY_CLASSES[variant][activityOf(active)],
    dragging ? 'opacity-65' : undefined,
    dropIndicator ? DROP_INDICATOR_CLASSES[dropIndicator] : undefined,
    className,
  ])
}

export function labelButtonClassName(variant: UnderlineTabVariant): string {
  return joinClassNames([
    'flex min-w-0 flex-1 items-center gap-2 bg-transparent text-left whitespace-nowrap cursor-default',
    FOCUS_RING,
    LABEL_BUTTON_PADDING_CLASSES[variant],
  ])
}

export function suffixSlotClassName(variant: UnderlineTabVariant): string {
  return joinClassNames(['flex shrink-0 items-center', SUFFIX_SLOT_CLASSES[variant]])
}
