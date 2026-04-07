import styles from './Slider.module.css'

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
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0

  return (
    <div className={`${styles.wrapper}${className ? ` ${className}` : ''}`}>
      {label && <label className={styles.label}>{label}</label>}
      <div className={styles.track}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className={styles.input}
          style={{ '--slider-value': `${pct}%` } as React.CSSProperties}
          aria-label={label ?? 'Slider'}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
        />
        <span className={styles.value} aria-hidden="true">
          {value}
        </span>
      </div>
    </div>
  )
}
