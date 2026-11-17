import { joinClassNames } from '../../../lib/class-names'
import { FOCUS_RING } from '../../../lib/focus-ring'
import { INVALID_CONTROL_EDGE, INVALID_CONTROL_FOCUS_RING } from '../../../lib/class-names-field'

export type ButtonVariant =
  | 'default'
  | 'accent'
  | 'subtle'
  | 'subtleMuted'
  | 'subtleAccent'
  | 'subtleToggled'
  | 'danger'
  | 'bare'

export type ButtonSize = 'md' | 'sm' | 'xs' | 'tiny' | 'chip' | 'cell' | 'toolbar' | 'menuTrigger'

export type ButtonSegment = 'whole' | 'start' | 'end'

type StyledButtonVariant = Exclude<ButtonVariant, 'bare'>
type ButtonTextTone =
  | 'primary'
  | 'onAccent'
  | 'onDanger'
  | 'muted'
  | 'accent'
  | 'accentSteady'
  | 'error'
  | 'errorExceptOnHover'
type ButtonShape = 'labelled' | 'iconOnly'

export type ButtonContentAlign = 'center' | 'start'

const SOLID_DISABLED =
  'disabled:bg-light-fill-subtle-pressed dark:disabled:bg-dark-fill-subtle-pressed disabled:border-light-stroke-control dark:disabled:border-dark-stroke-control'

const SUBTLE_SURFACE =
  'bg-transparent border-transparent not-disabled:hover:bg-light-fill-subtle-hover dark:not-disabled:hover:bg-dark-fill-subtle-hover not-disabled:active:bg-light-fill-subtle-pressed dark:not-disabled:active:bg-dark-fill-subtle-pressed'

type ButtonEdgeTone = 'valid' | 'invalid'

const DEFAULT_SIDE_STROKE =
  'border-x-light-stroke-control dark:border-x-dark-stroke-control border-t-light-stroke-control dark:border-t-dark-stroke-control'

const DEFAULT_EDGE_CLASSES: Record<ButtonEdgeTone, string> = {
  valid: joinClassNames([
    DEFAULT_SIDE_STROKE,
    'border-b-light-stroke-control-bottom dark:border-b-dark-stroke-control-bottom',
  ]),
  invalid: joinClassNames([DEFAULT_SIDE_STROKE, INVALID_CONTROL_EDGE]),
}

const ACCENT_SIDE_EDGE_CLASSES: Record<ButtonSegment, string> = {
  whole: 'border-x-stroke-accent',
  start: 'border-x-stroke-accent',
  end: 'border-l-light-on-primary-a30 dark:border-l-dark-on-primary-a30 border-r-stroke-accent',
}

const CORNER_CLASSES: Record<ButtonSegment, string> = {
  whole: 'rounded-control',
  start: 'rounded-l-control',
  end: 'rounded-r-control',
}

const FOCUS_CLASSES: Record<ButtonEdgeTone, string> = {
  valid: FOCUS_RING,
  invalid: INVALID_CONTROL_FOCUS_RING,
}

const SURFACE_CLASSES: Record<StyledButtonVariant, string> = {
  default: joinClassNames([
    'bg-light-fill-control dark:bg-dark-fill-control',
    'not-disabled:hover:bg-light-fill-control-hover dark:not-disabled:hover:bg-dark-fill-control-hover not-disabled:active:bg-light-fill-control-pressed dark:not-disabled:active:bg-dark-fill-control-pressed',
    SOLID_DISABLED,
  ]),
  accent: joinClassNames([
    'bg-light-primary dark:bg-dark-primary border-t-stroke-accent border-b-stroke-accent-bottom',
    'not-disabled:hover:bg-light-accent-hover dark:not-disabled:hover:bg-dark-accent-hover not-disabled:active:bg-light-primary-pressed dark:not-disabled:active:bg-dark-primary-pressed',
    SOLID_DISABLED,
  ]),
  danger: joinClassNames([
    'bg-light-danger-fill dark:bg-dark-danger-fill border-transparent',
    'not-disabled:hover:bg-light-danger-fill-hover dark:not-disabled:hover:bg-dark-danger-fill-hover not-disabled:active:bg-light-danger-fill-hover dark:not-disabled:active:bg-dark-danger-fill-hover',
    SOLID_DISABLED,
  ]),
  subtle: SUBTLE_SURFACE,
  subtleMuted: SUBTLE_SURFACE,
  subtleAccent: SUBTLE_SURFACE,
  subtleToggled: joinClassNames([
    'bg-light-fill-accent-tint dark:bg-dark-fill-accent-tint border-transparent',
    'not-disabled:hover:bg-light-fill-subtle-hover dark:not-disabled:hover:bg-dark-fill-subtle-hover not-disabled:active:bg-light-fill-subtle-pressed dark:not-disabled:active:bg-dark-fill-subtle-pressed',
    'disabled:bg-transparent',
  ]),
}

const TEXT_CLASSES: Record<ButtonTextTone, string> = {
  primary:
    'text-light-on-surface dark:text-dark-on-surface not-disabled:active:text-light-on-surface-variant dark:not-disabled:active:text-dark-on-surface-variant',
  onAccent: 'text-light-on-primary dark:text-dark-on-primary',
  onDanger: 'text-on-danger-fill',
  muted: 'text-light-on-surface-variant dark:text-dark-on-surface-variant',
  accent:
    'text-light-primary dark:text-dark-primary not-disabled:active:text-light-on-surface-variant dark:not-disabled:active:text-dark-on-surface-variant',
  accentSteady: 'text-light-primary dark:text-dark-primary',
  error: 'text-light-error dark:text-dark-error',
  errorExceptOnHover:
    'text-light-error dark:text-dark-error not-disabled:hover:text-on-danger-fill not-disabled:active:text-light-error dark:not-disabled:active:text-dark-error',
}

const VARIANT_TEXT_TONE: Record<StyledButtonVariant, ButtonTextTone> = {
  default: 'primary',
  accent: 'onAccent',
  danger: 'onDanger',
  subtle: 'primary',
  subtleMuted: 'muted',
  subtleAccent: 'accentSteady',
  subtleToggled: 'accent',
}

const ALIGN_CLASSES: Record<ButtonContentAlign, string> = {
  center: 'justify-center',
  start: 'justify-start',
}

const SIZE_CLASSES: Record<ButtonSize, Record<ButtonShape, string>> = {
  md: {
    labelled: 'h-control gap-2 px-3 text-body',
    iconOnly: 'h-control w-control gap-2 px-0 text-body',
  },
  sm: {
    labelled: 'h-control-sm gap-1.5 px-2.5 text-size-row leading-5',
    iconOnly: 'h-control-sm w-control-sm gap-1.5 px-0 text-size-row leading-5',
  },
  xs: {
    labelled: 'h-6 gap-1.5 px-2.5 align-middle text-size-row leading-5',
    iconOnly: 'size-6 gap-1.5 px-0 align-middle text-size-row leading-5',
  },
  tiny: {
    labelled: 'h-5 gap-1.5 px-2.5 text-size-row leading-5',
    iconOnly: 'size-5 gap-1.5 px-0 text-size-row leading-5',
  },
  chip: {
    labelled: 'h-control-sm gap-1.5 px-1.5 py-0.5 text-size-caption leading-5',
    iconOnly: 'size-control-sm gap-1.5 px-0 py-0.5 text-size-caption leading-5',
  },
  cell: {
    labelled: 'h-7.5 gap-2 px-3 text-size-row leading-5',
    iconOnly: 'size-7.5 gap-2 px-0 text-size-row leading-5',
  },
  toolbar: {
    labelled: 'h-control-sm gap-1.5 px-2.5 text-row',
    iconOnly: 'h-control-sm w-control-sm gap-1.5 px-0 text-row',
  },
  menuTrigger: {
    labelled: 'h-control gap-2 px-3 text-body',
    iconOnly: 'h-control w-control-sm gap-2 px-0 text-body',
  },
}

export interface ButtonClassOptions {
  variant: ButtonVariant
  size: ButtonSize
  dangerText: boolean
  iconOnly: boolean
  invalid: boolean
  contentAlign: ButtonContentAlign
  segment: ButtonSegment
  className: string | undefined
}

function textTone(variant: StyledButtonVariant, dangerText: boolean): ButtonTextTone {
  if (!dangerText) return VARIANT_TEXT_TONE[variant]
  if (variant === 'danger') return 'errorExceptOnHover'
  return 'error'
}

function edgeTone(variant: StyledButtonVariant, invalid: boolean): ButtonEdgeTone {
  const isInvalidDefault = variant === 'default' && invalid
  if (isInvalidDefault) return 'invalid'
  return 'valid'
}

interface ButtonEdge {
  tone: ButtonEdgeTone
  segment: ButtonSegment
}

function edgeClasses(variant: StyledButtonVariant, edge: ButtonEdge): string | undefined {
  if (variant === 'default') return DEFAULT_EDGE_CLASSES[edge.tone]
  if (variant === 'accent') return ACCENT_SIDE_EDGE_CLASSES[edge.segment]
  return undefined
}

function shapeOf(iconOnly: boolean): ButtonShape {
  if (iconOnly) return 'iconOnly'
  return 'labelled'
}

export function buttonClassName({
  variant,
  size,
  dangerText,
  iconOnly,
  invalid,
  contentAlign,
  segment,
  className,
}: ButtonClassOptions): string | undefined {
  if (variant === 'bare') return className
  const tone = edgeTone(variant, invalid)
  return joinClassNames([
    'inline-flex items-center border cursor-default whitespace-nowrap font-body font-regular disabled:cursor-not-allowed',
    CORNER_CLASSES[segment],
    FOCUS_CLASSES[tone],
    SURFACE_CLASSES[variant],
    edgeClasses(variant, { tone: tone, segment: segment }),
    TEXT_CLASSES[textTone(variant, dangerText)],
    'disabled:text-light-text-disabled dark:disabled:text-dark-text-disabled',
    ALIGN_CLASSES[contentAlign],
    SIZE_CLASSES[size][shapeOf(iconOnly)],
    className,
  ])
}
