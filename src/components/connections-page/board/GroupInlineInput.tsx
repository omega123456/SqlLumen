import { useEffect, useRef } from 'react'
import { TextInput } from '../../common/TextInput'
import { joinClassNames } from '../../../lib/class-names'
import { FIELD_CHROME } from '../../../lib/class-names-field'

interface GroupInlineInputProps {
  value: string
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
  placeholder?: string
  ariaLabel: string
}

export function GroupInlineInput({
  value,
  onChange,
  onCommit,
  onCancel,
  placeholder,
  ariaLabel,
}: GroupInlineInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [])

  return (
    <TextInput
      ref={inputRef}
      variant="bare"
      type="text"
      className={joinClassNames([
        FIELD_CHROME,
        'w-full px-1 py-0.5 text-size-caption font-semibold',
      ])}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        const keyActions: Partial<Record<string, () => void>> = {
          Enter: onCommit,
          Escape: onCancel,
        }
        keyActions[event.key]?.()
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  )
}
