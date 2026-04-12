import { forwardRef, type ButtonHTMLAttributes } from 'react'
import styles from './IconButton.module.css'

export type IconButtonSize = 'sm' | 'md' | 'lg'

function mergeClassNames(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Visual size: sm (20px), md (28px), lg (36px). Defaults to md. */
  size?: IconButtonSize
}

/**
 * A minimal icon-only action button with consistent hit areas and focus rings.
 * Use for toolbar/panel icon actions (close, copy, clear, etc.).
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 'md', className, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={mergeClassNames(styles.iconButton, styles[size], className)}
      {...rest}
    />
  )
})
