import { forwardRef, type InputHTMLAttributes } from 'react'
import { joinClassNames } from '../../lib/class-names'
import { FOCUS_RING } from '../../lib/focus-ring'

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      type="checkbox"
      className={joinClassNames([
        'relative size-5 shrink-0 appearance-none rounded-control border cursor-default outline-none text-light-on-primary dark:text-dark-on-primary',
        FOCUS_RING,
        'border-light-on-surface-variant dark:border-dark-on-surface-variant bg-light-fill-control dark:bg-dark-fill-control not-disabled:hover:bg-light-fill-control-hover dark:not-disabled:hover:bg-dark-fill-control-hover',
        'disabled:cursor-not-allowed disabled:bg-transparent disabled:border-light-text-disabled dark:disabled:border-dark-text-disabled',
        'checked:bg-light-primary dark:checked:bg-dark-primary checked:border-light-primary dark:checked:border-dark-primary checked:not-disabled:hover:bg-light-accent-hover dark:checked:not-disabled:hover:bg-dark-accent-hover checked:not-disabled:hover:border-light-accent-hover dark:checked:not-disabled:hover:border-dark-accent-hover checked:disabled:bg-light-text-disabled dark:checked:disabled:bg-dark-text-disabled checked:disabled:border-transparent',
        'indeterminate:bg-light-primary dark:indeterminate:bg-dark-primary indeterminate:border-light-primary dark:indeterminate:border-dark-primary indeterminate:not-disabled:hover:bg-light-accent-hover dark:indeterminate:not-disabled:hover:bg-dark-accent-hover indeterminate:not-disabled:hover:border-light-accent-hover dark:indeterminate:not-disabled:hover:border-dark-accent-hover indeterminate:disabled:bg-light-text-disabled dark:indeterminate:disabled:bg-dark-text-disabled indeterminate:disabled:border-transparent',
        'checked:after:absolute checked:after:left-1/2 checked:after:top-1/2 checked:after:-mt-px checked:after:h-1.25 checked:after:w-2.5 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2 checked:after:-rotate-45 checked:after:border-b-check checked:after:border-l-check',
        'indeterminate:after:absolute indeterminate:after:left-1/2 indeterminate:after:top-1/2 indeterminate:after:h-0 indeterminate:after:w-2.5 indeterminate:after:-translate-x-1/2 indeterminate:after:-translate-y-1/2 indeterminate:after:border-t-check',
        className,
      ])}
      {...rest}
    />
  )
})
