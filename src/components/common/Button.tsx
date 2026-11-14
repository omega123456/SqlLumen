import { forwardRef, type ButtonHTMLAttributes } from 'react'

type StyledButtonVariant = 'default' | 'accent' | 'subtle' | 'danger'

export type ButtonVariant = StyledButtonVariant | 'bare'

export type ButtonSize = 'md' | 'sm'

const VARIANT_CLASS: Record<StyledButtonVariant, string | undefined> = {
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
  dangerText?: boolean
  iconOnly?: boolean
}

interface ButtonClassOptions {
  variant: ButtonVariant
  size: ButtonSize
  dangerText: boolean
  iconOnly: boolean
  className: string | undefined
}

function resolveButtonClassName({
  variant,
  size,
  dangerText,
  iconOnly,
  className,
}: ButtonClassOptions): string | undefined {
  if (variant === 'bare') return className
  return mergeClassNames(
    'ui-button',
    VARIANT_CLASS[variant],
    size === 'sm' && 'ui-button--sm',
    iconOnly && 'ui-button--icon',
    dangerText && 'ui-button--danger-text',
    className
  )
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
      className={resolveButtonClassName({ variant, size, dangerText, iconOnly, className })}
      {...rest}
    />
  )
})
