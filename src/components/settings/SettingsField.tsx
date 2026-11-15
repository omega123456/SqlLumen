import type { ReactNode } from 'react'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { joinClassNames } from '../../lib/class-names'

export interface SettingsFieldLabelProps {
  id?: string
  htmlFor?: string
  children: ReactNode
}

export function SettingsFieldLabel({ id, htmlFor, children }: SettingsFieldLabelProps) {
  return (
    <label id={id} htmlFor={htmlFor} className="mb-1.5 block text-size-caption">
      {children}
    </label>
  )
}

export type SettingsCaptionTone = 'muted' | 'error'

const CAPTION_TONE_CLASSES: Record<SettingsCaptionTone, string> = {
  muted: 'text-light-on-surface-variant dark:text-dark-on-surface-variant',
  error: 'text-light-error dark:text-dark-error',
}

export interface SettingsCaptionProps {
  id?: string
  tone?: SettingsCaptionTone
  'data-testid'?: string
  children: ReactNode
}

export function SettingsCaption({
  id,
  tone = 'muted',
  'data-testid': dataTestId,
  children,
}: SettingsCaptionProps) {
  return (
    <p
      id={id}
      className={joinClassNames([
        'mt-1.5 text-caption wrap-break-word',
        CAPTION_TONE_CLASSES[tone],
      ])}
      data-testid={dataTestId}
    >
      {children}
    </p>
  )
}

export interface SettingsDropdownFieldProps {
  name: string
  label: ReactNode
  options: DropdownOption[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export function SettingsDropdownField({
  name,
  label,
  options,
  value,
  onChange,
  disabled,
}: SettingsDropdownFieldProps) {
  const labelId = `${name}-label`
  return (
    <div>
      <SettingsFieldLabel id={labelId}>{label}</SettingsFieldLabel>
      <Dropdown
        id={`settings-${name}`}
        labelledBy={labelId}
        options={options}
        value={value}
        onChange={onChange}
        disabled={disabled}
        data-testid={`settings-${name}-dropdown`}
      />
    </div>
  )
}
