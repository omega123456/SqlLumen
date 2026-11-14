import { joinClassNames } from '../../../lib/class-names'
import { FOCUS_RING } from '../../../lib/focus-ring'

export type ButtonVariant =
  'default' | 'accent' | 'subtle' | 'subtleMuted' | 'subtleToggled' | 'danger' | 'bare'

export type ButtonSize = 'md' | 'sm' | 'xs'

type StyledButtonVariant = Exclude<ButtonVariant, 'bare'>
type ButtonTextTone =
  'primary' | 'onAccent' | 'onDanger' | 'muted' | 'accent' | 'error' | 'errorExceptOnHover'
type ButtonShape = 'labelled' | 'iconOnly'

export type ButtonContentAlign = 'center' | 'start'

const SOLID_DISABLED =
  'disabled:bg-light-fill-subtle-pressed dark:disabled:bg-dark-fill-subtle-pressed disabled:border-light-stroke-control dark:disabled:border-dark-stroke-control'

const SUBTLE_SURFACE =
  'bg-transparent border-transparent not-disabled:hover:bg-light-fill-subtle-hover dark:not-disabled:hover:bg-dark-fill-subtle-hover not-disabled:active:bg-light-fill-subtle-pressed dark:not-disabled:active:bg-dark-fill-subtle-pressed'

const SURFACE_CLASSES: Record<StyledButtonVariant, string> = {
  default: joinClassNames([
    'bg-light-fill-control dark:bg-dark-fill-control border-x-light-stroke-control dark:border-x-dark-stroke-control border-t-light-stroke-control dark:border-t-dark-stroke-control border-b-light-stroke-control-bottom dark:border-b-dark-stroke-control-bottom',
    'not-disabled:hover:bg-light-fill-control-hover dark:not-disabled:hover:bg-dark-fill-control-hover not-disabled:active:bg-light-fill-control-pressed dark:not-disabled:active:bg-dark-fill-control-pressed',
    SOLID_DISABLED,
  ]),
  accent: joinClassNames([
    'bg-light-primary dark:bg-dark-primary border-x-stroke-accent border-t-stroke-accent border-b-stroke-accent-bottom',
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
}

export interface ButtonClassOptions {
  variant: ButtonVariant
  size: ButtonSize
  dangerText: boolean
  iconOnly: boolean
  contentAlign: ButtonContentAlign
  className: string | undefined
}

function textTone(variant: StyledButtonVariant, dangerText: boolean): ButtonTextTone {
  if (!dangerText) return VARIANT_TEXT_TONE[variant]
  if (variant === 'danger') return 'errorExceptOnHover'
  return 'error'
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
  contentAlign,
  className,
}: ButtonClassOptions): string | undefined {
  if (variant === 'bare') return className
  return joinClassNames([
    'inline-flex items-center rounded-control border cursor-default whitespace-nowrap font-body font-regular disabled:cursor-not-allowed',
    FOCUS_RING,
    SURFACE_CLASSES[variant],
    TEXT_CLASSES[textTone(variant, dangerText)],
    'disabled:text-light-text-disabled dark:disabled:text-dark-text-disabled',
    ALIGN_CLASSES[contentAlign],
    SIZE_CLASSES[size][shapeOf(iconOnly)],
    className,
  ])
}
