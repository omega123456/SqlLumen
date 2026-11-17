import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { dataFlag } from '../../lib/data-attributes'
import {
  buttonClassName,
  type ButtonContentAlign,
  type ButtonSegment,
  type ButtonSize,
  type ButtonVariant,
} from './button/button-classes'

export type { ButtonSize, ButtonVariant }

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  dangerText?: boolean
  iconOnly?: boolean
  invalid?: boolean
  contentAlign?: ButtonContentAlign
  segment?: ButtonSegment
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'default',
    size = 'md',
    dangerText = false,
    iconOnly = false,
    invalid = false,
    contentAlign = 'center',
    segment = 'whole',
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
      data-variant={variant}
      data-size={size}
      data-icon-only={dataFlag(iconOnly)}
      data-invalid={dataFlag(invalid)}
      data-danger-text={dataFlag(dangerText)}
      data-align={contentAlign}
      data-segment={segment}
      className={buttonClassName({
        variant,
        size,
        dangerText,
        iconOnly,
        invalid,
        contentAlign,
        segment,
        className,
      })}
      {...rest}
    />
  )
})
