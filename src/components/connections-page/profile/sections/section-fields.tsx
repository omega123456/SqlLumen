import { TextInput, type TextInputProps } from '../../../common/TextInput'
import type { ConnectionFormData } from '../../../../types/connection'
import type { ProfileEditor } from '../use-profile-editor'

const DECIMAL_RADIX = 10
const INVALID_NUMBER = 0

type TextField = 'host' | 'username' | 'name'
type NumberField = 'port' | 'connectTimeoutSecs' | 'keepaliveIntervalSecs'

interface FieldInputProps<TField extends keyof ConnectionFormData> {
  id: string
  profile: ProfileEditor
  field: TField
  input?: Omit<TextInputProps, 'id' | 'value' | 'onChange'>
}

export function TextFieldInput({ id, profile, field, input }: FieldInputProps<TextField>) {
  const editor = profile.form.editor
  return (
    <TextInput
      id={id}
      value={editor.formData[field]}
      invalid={editor.errors[field] !== undefined}
      onChange={(event) => profile.form.updateField(field, event.target.value)}
      autoComplete="off"
      spellCheck={false}
      {...input}
    />
  )
}

function wholeNumberOf(text: string): number {
  const parsed = parseInt(text, DECIMAL_RADIX)
  return isNaN(parsed) ? INVALID_NUMBER : parsed
}

export function NumberFieldInput({ id, profile, field, input }: FieldInputProps<NumberField>) {
  const editor = profile.form.editor
  return (
    <TextInput
      id={id}
      variant="mono"
      inputMode="numeric"
      value={editor.formData[field]}
      invalid={editor.errors[field] !== undefined}
      onChange={(event) => profile.form.updateField(field, wholeNumberOf(event.target.value))}
      autoComplete="off"
      {...input}
    />
  )
}
