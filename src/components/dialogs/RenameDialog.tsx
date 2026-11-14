import { useState, useEffect, useCallback } from 'react'
import { Button } from '../common/Button'
import { TextInput } from '../common/TextInput'
import { DialogShell } from './DialogShell'
import styles from './RenameDialog.module.css'
import { MYSQL_IDENTIFIER_MAX_LENGTH } from '../../lib/sql-utils'
import { useFormSubmit } from '../../hooks/useFormSubmit'

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

const RENAME_DIALOG_MAX_WIDTH = 440

function isValidRename(trimmedName: string, currentName: string): boolean {
  if (trimmedName.length === 0) return false
  if (trimmedName.length > MYSQL_IDENTIFIER_MAX_LENGTH) return false
  return trimmedName !== currentName
}

interface RenameFieldsProps {
  warning: string | undefined
  currentName: string
  newName: string
  onNewNameChange: (value: string) => void
  error: string | null | undefined
}

function RenameFields({
  warning,
  currentName,
  newName,
  onNewNameChange,
  error,
}: RenameFieldsProps) {
  return (
    <>
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
          New name
        </label>
        <TextInput
          id="rename-new-name"
          type="text"
          value={newName}
          onChange={(event) => onNewNameChange(event.target.value)}
          maxLength={MYSQL_IDENTIFIER_MAX_LENGTH}
          autoFocus
          data-testid="rename-name-input"
        />
      </div>

      {error && (
        <div className={styles.error} data-testid="rename-dialog-error">
          {error}
        </div>
      )}
    </>
  )
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

  useEffect(() => {
    setNewName(currentName)
  }, [currentName])

  const trimmedNew = newName.trim()
  const isValid = isValidRename(trimmedNew, currentName)

  const handleSubmit = useCallback(() => {
    if (!isValid) return
    if (isLoading) return
    onConfirm(trimmedNew)
  }, [isLoading, isValid, onConfirm, trimmedNew])

  const handleFormSubmit = useFormSubmit(handleSubmit)

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onCancel}
      maxWidth={RENAME_DIALOG_MAX_WIDTH}
      testId="rename-dialog"
      ariaLabel={title}
      formProps={{ onSubmit: handleFormSubmit }}
    >
      <h2 className={styles.title}>{title}</h2>
      <RenameFields
        warning={warning}
        currentName={currentName}
        newName={newName}
        onNewNameChange={setNewName}
        error={error}
      />
      <div className={styles.actions}>
        <Button
          variant="accent"
          type="submit"
          disabled={!isValid || isLoading}
          data-testid="rename-confirm-button"
        >
          {isLoading ? 'Renaming...' : 'Rename'}
        </Button>
        <Button onClick={onCancel} data-testid="rename-cancel-button">
          Cancel
        </Button>
      </div>
    </DialogShell>
  )
}
