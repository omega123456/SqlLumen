import { forwardRef, type ButtonHTMLAttributes } from 'react'

/** Fluent button variants: default (control fill), accent, subtle (transparent) and danger (fill). */
export type ButtonVariant = 'default' | 'accent' | 'subtle' | 'danger'

/** md is 32px (dialogs, command bars); sm is 28px (result and grid toolbars). */
export type ButtonSize = 'md' | 'sm'

const VARIANT_CLASS: Record<ButtonVariant, string | undefined> = {
  default: undefined,
  accent: 'ui-button--accent',
  subtle: 'ui-button--subtle',
  danger: 'ui-button--danger',
}

function mergeClassNames(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Danger-coloured label on a non-danger fill (e.g. subtle "Delete" toolbar actions). */
  dangerText?: boolean
  /** Square icon-only button (32px, or 28px with size="sm"). */
  iconOnly?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'default',
    size = 'md',
    dangerText = false,
    iconOnly = false,
    className,
    type = 'button',
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={mergeClassNames(
        'ui-button',
        VARIANT_CLASS[variant],
        size === 'sm' && 'ui-button--sm',
        iconOnly && 'ui-button--icon',
        dangerText && 'ui-button--danger-text',
        className
      )}
      {...rest}
    />
  )
})
