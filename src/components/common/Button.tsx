import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { dataFlag } from '../../lib/data-attributes'
import {
  buttonClassName,
  type ButtonContentAlign,
  type ButtonSize,
  type ButtonVariant,
} from './button/button-classes'

export type { ButtonSize, ButtonVariant }

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  dangerText?: boolean
  iconOnly?: boolean
  contentAlign?: ButtonContentAlign
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'default',
    size = 'md',
    dangerText = false,
    iconOnly = false,
    contentAlign = 'center',
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
      data-danger-text={dataFlag(dangerText)}
      data-align={contentAlign}
      className={buttonClassName({ variant, size, dangerText, iconOnly, contentAlign, className })}
      {...rest}
    />
  )
})
