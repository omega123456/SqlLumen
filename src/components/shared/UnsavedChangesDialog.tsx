/**
 * UnsavedChangesDialog — confirmation dialog shown when the user
 * attempts navigation (page change, refresh, etc.) with unsaved edits.
 *
 * This is a generic, reusable dialog that receives all data as props —
 * no store dependencies.
 */

import { useState, useCallback } from 'react'
import { Button } from '../common/Button'
import { DialogShell } from '../dialogs/DialogShell'
import styles from './UnsavedChangesDialog.module.css'

const isPlaywright = import.meta.env.VITE_PLAYWRIGHT === 'true'

interface UnsavedChangesDialogProps {
  tabId: string
  onSave: () => Promise<void>
  onDiscard: () => void
  onCancel: () => void
  isSaving?: boolean
  error?: string | null
  title?: string
  message?: React.ReactNode
  saveLabel?: string
  discardLabel?: string
  cancelLabel?: string
}

export function UnsavedChangesDialog({
  onSave,
  onDiscard,
  onCancel,
  isSaving: externalIsSaving,
  error: externalError,
  title = 'Unsaved Changes',
  message = 'You have unsaved changes on the current row. What would you like to do?',
  saveLabel = 'Save Changes',
  discardLabel = 'Discard Changes',
  cancelLabel = 'Cancel',
}: UnsavedChangesDialogProps) {
  const [internalSaving, setInternalSaving] = useState(false)
  const [internalError, setInternalError] = useState<string | null>(null)

  const isSaving = externalIsSaving ?? internalSaving
  const error = externalError ?? internalError

  const handleSave = useCallback(async () => {
    setInternalSaving(true)
    setInternalError(null)
    try {
      await onSave()
    } catch (err) {
      setInternalError(err instanceof Error ? err.message : String(err))
    } finally {
      setInternalSaving(false)
    }
  }, [onSave])

  return (
    <DialogShell
      isOpen={true}
      onClose={onCancel}
      maxWidth={400}
      testId="unsaved-changes-dialog"
      ariaLabel="Unsaved Changes"
      disableFocusManagement={isPlaywright}
    >
      <div className={styles.root}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
        </div>

        <div className={styles.body}>
          <p className={styles.message}>{message}</p>

          {error && (
            <div className={styles.error} data-testid="unsaved-changes-error">
              {error}
            </div>
          )}
        </div>

        <div className={styles.actions}>
          <Button
            type="button"
            variant="ghost"
            className={styles.cancelButton}
            onClick={onCancel}
            data-testid="btn-cancel-changes"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={styles.discardButton}
            onClick={onDiscard}
            data-testid="btn-discard-changes"
          >
            {discardLabel}
          </Button>
          <Button
            type="button"
            variant="primary"
            className={styles.saveButton}
            onClick={() => void handleSave()}
            disabled={isSaving}
            data-testid="btn-save-changes"
          >
            {isSaving ? 'Saving...' : saveLabel}
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
