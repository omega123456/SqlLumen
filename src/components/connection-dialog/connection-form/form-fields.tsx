import type { ReactNode } from 'react'
import { Eye, EyeSlash, FolderOpen } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { TextInput } from '../../common/TextInput'
import { IconButton } from '../../common/IconButton'
import { Checkbox } from '../../common/Checkbox'
import type { ConnectionFormData } from '../../../types/connection'
import type { FormErrors, UpdateField } from '../connection-editor-state'
import {
  CONNECTION_FIELD_GROUP,
  CONNECTION_FIELD_LABEL,
} from '../../../lib/class-names-connection-form'

const FIELD_ICON_SIZE = 16

export interface FormFieldProps {
  id: string
  label: string
  error?: string
  children: ReactNode
}

export function FormField({ id, label, error, children }: FormFieldProps) {
  return (
    <div className={CONNECTION_FIELD_GROUP}>
      <label htmlFor={id} className={CONNECTION_FIELD_LABEL}>
        {label}
      </label>
      {children}
      {error && <span className="text-caption text-light-error dark:text-dark-error">{error}</span>}
    </div>
  )
}

interface SslFileFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  onBrowse: () => void
  disabled: boolean
  browseLabel: string
  placeholder?: string
}

export function SslFileField({
  id,
  label,
  value,
  onChange,
  onBrowse,
  disabled,
  browseLabel,
  placeholder,
}: SslFileFieldProps) {
  return (
    <div className={CONNECTION_FIELD_GROUP}>
      <label
        htmlFor={id}
        className="font-body text-size-body font-regular text-light-on-surface-variant dark:text-dark-on-surface-variant"
      >
        {label}
      </label>
      <div className="flex gap-1">
        <TextInput
          type="text"
          id={id}
          variant="mono"
          className="min-w-0 flex-1"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
        />
        <Button
          variant="bare"
          className="flex shrink-0 cursor-pointer items-center justify-center rounded-control border border-light-stroke-control bg-light-fill-control px-2 py-1 text-light-on-surface transition-bg-and-color not-disabled:hover:bg-light-fill-control-hover disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-stroke-control dark:bg-dark-fill-control dark:text-dark-on-surface dark:not-disabled:hover:bg-dark-fill-control-hover"
          onClick={onBrowse}
          disabled={disabled}
          aria-label={browseLabel}
        >
          <FolderOpen size={FIELD_ICON_SIZE} />
        </Button>
      </div>
    </div>
  )
}

export interface FormFields {
  formData: ConnectionFormData
  errors: FormErrors
  updateField: UpdateField
}

export interface PasswordControls {
  showPassword: boolean
  hasSavedPassword: boolean
  clearSavedPassword: boolean
  showDuplicateHint: boolean
  onPasswordChange: (value: string) => void
  onToggleShowPassword: () => void
  onClearSavedPasswordChange: (checked: boolean) => void
}

const SAVED_PASSWORD_MASK = '••••••••'

function savedPasswordPlaceholder(password: PasswordControls): string {
  if (!password.hasSavedPassword) return ''
  if (password.clearSavedPassword) return ''
  return SAVED_PASSWORD_MASK
}

interface PasswordFieldProps {
  value: string
  password: PasswordControls
}

export function PasswordField({ value, password }: PasswordFieldProps) {
  return (
    <FormField id="conn-password" label="Password">
      <div className="relative flex items-center">
        <TextInput
          id="conn-password"
          type={password.showPassword ? 'text' : 'password'}
          passwordToggleGutter
          value={value}
          onChange={(event) => password.onPasswordChange(event.target.value)}
          placeholder={savedPasswordPlaceholder(password)}
          disabled={password.clearSavedPassword}
        />
        <IconButton
          size="sm"
          className="absolute right-1"
          onClick={password.onToggleShowPassword}
          aria-label={password.showPassword ? 'Hide password' : 'Show password'}
        >
          {password.showPassword ? (
            <EyeSlash size={FIELD_ICON_SIZE} />
          ) : (
            <Eye size={FIELD_ICON_SIZE} />
          )}
        </IconButton>
      </div>
      {password.showDuplicateHint && (
        <span
          className="text-caption text-light-on-surface-variant dark:text-dark-on-surface-variant"
          data-testid="duplicate-password-hint"
        >
          Password is not copied — enter it to save.
        </span>
      )}
      {password.hasSavedPassword && (
        <label className="font-body text-size-body font-regular text-light-on-surface-variant dark:text-dark-on-surface-variant">
          <Checkbox
            checked={password.clearSavedPassword}
            onChange={(event) => password.onClearSavedPasswordChange(event.target.checked)}
          />{' '}
          Use no password (remove saved password)
        </label>
      )}
    </FormField>
  )
}
