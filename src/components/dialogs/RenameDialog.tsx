import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { Button } from '../common/Button'
import { TextInput } from '../common/TextInput'
import { DialogShell } from './DialogShell'
import styles from './RenameDialog.module.css'

export interface RenameDialogProps {
  isOpen: boolean
  title: string
  currentName: string
  warning?: string
  isLoading?: boolean
  error?: string | null
  onConfirm: (newName: string) => void
  onCancel: () => void
}

export function RenameDialog({
  isOpen,
  title,
  currentName,
  warning,
  isLoading = false,
  error,
  onConfirm,
  onCancel,
}: RenameDialogProps) {
  const [newName, setNewName] = useState(currentName)

  // Reset input when dialog opens with a new target
  useEffect(() => {
    setNewName(currentName)
  }, [currentName])

  const trimmedNew = newName.trim()
  const isValid = trimmedNew.length > 0 && trimmedNew.length <= 64 && trimmedNew !== currentName

  const handleSubmit = useCallback(() => {
    if (!isValid || isLoading) return
    onConfirm(trimmedNew)
  }, [isLoading, isValid, onConfirm, trimmedNew])

  const handleFormSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      handleSubmit()
    },
    [handleSubmit]
  )

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onCancel}
      maxWidth={440}
      testId="rename-dialog"
      ariaLabel={title}
      formProps={{ onSubmit: handleFormSubmit }}
    >
      <h2 className={styles.title}>{title}</h2>

      {warning && (
        <div className={styles.warningBox} data-testid="rename-dialog-warning">
          {warning}
        </div>
      )}

      <p className={styles.currentName}>
        Current name: <span className={styles.currentNameValue}>{currentName}</span>
      </p>

      <div>
        <label className={styles.label} htmlFor="rename-new-name">
          New Name
        </label>
        <TextInput
          id="rename-new-name"
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={64}
          autoFocus
          data-testid="rename-name-input"
        />
      </div>

      {error && (
        <div className={styles.error} data-testid="rename-dialog-error">
          {error}
        </div>
      )}

      <div className={styles.actions}>
        <Button variant="secondary" onClick={onCancel} data-testid="rename-cancel-button">
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          disabled={!isValid || isLoading}
          data-testid="rename-confirm-button"
        >
          {isLoading ? 'Renaming...' : 'Rename'}
        </Button>
      </div>
    </DialogShell>
  )
}
