import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { joinClassNames } from '../../lib/class-names'
import { FOCUS_RING } from '../../lib/focus-ring'

export type IconButtonSize = 'sm' | 'md' | 'lg'

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  sm: 'size-6',
  md: 'size-control-sm',
  lg: 'size-control',
}

export type IconButtonTone = 'default' | 'mutedAccentOnHover'

const TONE_CLASSES: Record<IconButtonTone, string> = {
  default:
    'text-light-on-surface dark:text-dark-on-surface not-disabled:active:text-light-on-surface-variant dark:not-disabled:active:text-dark-on-surface-variant disabled:text-light-text-disabled dark:disabled:text-dark-text-disabled',
  mutedAccentOnHover:
    'text-light-on-surface-variant dark:text-dark-on-surface-variant not-disabled:hover:text-light-primary dark:not-disabled:hover:text-dark-primary disabled:text-light-text-disabled dark:disabled:text-dark-text-disabled',
}

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: IconButtonSize
  tone?: IconButtonTone
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 'md', tone = 'default', className, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      data-size={size}
      className={joinClassNames([
        'inline-flex shrink-0 items-center justify-center rounded-control border border-transparent bg-transparent p-0 cursor-default disabled:cursor-not-allowed',
        FOCUS_RING,
        'not-disabled:hover:bg-light-fill-subtle-hover dark:not-disabled:hover:bg-dark-fill-subtle-hover not-disabled:active:bg-light-fill-subtle-pressed dark:not-disabled:active:bg-dark-fill-subtle-pressed',
        TONE_CLASSES[tone],
        SIZE_CLASSES[size],
        className,
      ])}
      {...rest}
    />
  )
})
