/**
 * UnsavedChangesDialog — confirmation dialog shown when the user
 * attempts navigation (page change, refresh, etc.) with unsaved edits.
 *
 * This is a generic, reusable dialog that receives all data as props —
 * no store dependencies.
 */

import { useState, useCallback } from 'react'
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
}

export function UnsavedChangesDialog({
  onSave,
  onDiscard,
  onCancel,
  isSaving: externalIsSaving,
  error: externalError,
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
          <h2 className={styles.title}>Unsaved Changes</h2>
        </div>

        <div className={styles.body}>
          <p className={styles.message}>
            You have unsaved changes on the current row. What would you like to do?
          </p>

          {error && (
            <div className={styles.error} data-testid="unsaved-changes-error">
              {error}
            </div>
          )}
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={onCancel}
            data-testid="btn-cancel-changes"
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.discardButton}
            onClick={onDiscard}
            data-testid="btn-discard-changes"
          >
            Discard Changes
          </button>
          <button
            type="button"
            className={styles.saveButton}
            onClick={handleSave}
            disabled={isSaving}
            data-testid="btn-save-changes"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </DialogShell>
  )
}
