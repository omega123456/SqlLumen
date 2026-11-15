import { joinClassNames } from '../../lib/class-names'
import { FOCUS_RING } from '../../lib/focus-ring'
import { PERCENT_SCALE } from '../../lib/units'

export interface SliderProps {
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
  label?: string
  disabled?: boolean
  className?: string
}

export function Slider({
  min,
  max,
  step,
  value,
  onChange,
  label,
  disabled = false,
  className,
}: SliderProps): React.JSX.Element {
  const percent = max > min ? ((value - min) / (max - min)) * PERCENT_SCALE : 0

  return (
    <div className={joinClassNames(['flex flex-col gap-1', className])}>
      {label && (
        <label className="select-none font-body text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
          {label}
        </label>
      )}
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          className={joinClassNames([
            'h-1 flex-1 appearance-none rounded-track cursor-pointer bg-linear-to-r from-light-primary to-light-primary dark:from-dark-primary dark:to-dark-primary bg-light-surface-container-highest dark:bg-dark-surface-container-highest bg-left bg-no-repeat transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-40',
            'slider-thumb:size-4 slider-thumb:appearance-none slider-thumb:cursor-pointer slider-thumb:rounded-round slider-thumb:border-2 slider-thumb:border-solid slider-thumb:border-light-primary dark:slider-thumb:border-dark-primary slider-thumb:bg-light-primary dark:slider-thumb:bg-dark-primary slider-thumb:transition-shadow slider-thumb:duration-150 disabled:slider-thumb:cursor-not-allowed',
            'slider-thumb:hover:shadow-light-slider-thumb-hover dark:slider-thumb:hover:shadow-dark-slider-thumb-hover focus-visible:slider-thumb:shadow-light-slider-thumb-focus dark:focus-visible:slider-thumb:shadow-dark-slider-thumb-focus',
            FOCUS_RING,
          ])}
          style={{ backgroundSize: `${percent}% 100%` }}
          aria-label={label ?? 'Slider'}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
        />
        <span
          className="min-w-7.5 select-none text-right font-mono text-size-caption text-light-on-surface dark:text-dark-on-surface"
          aria-hidden="true"
        >
          {value}
        </span>
      </div>
    </div>
  )
}
