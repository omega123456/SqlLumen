import { useState, useCallback } from 'react'
import { Button } from '../common/Button'
import { DialogShell } from '../dialogs/DialogShell'
import styles from './UnsavedChangesDialog.module.css'
import { toErrorMessage } from '../../lib/error-message'
import { isPlaywrightBuild } from '../../lib/tauri-env'

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

function useUnsavedChangesSave(onSave: () => Promise<void>) {
  const [internalSaving, setInternalSaving] = useState(false)
  const [internalError, setInternalError] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    setInternalSaving(true)
    setInternalError(null)
    try {
      await onSave()
    } catch (error) {
      setInternalError(toErrorMessage(error))
    } finally {
      setInternalSaving(false)
    }
  }, [onSave])

  return { internalSaving, internalError, handleSave }
}

interface UnsavedChangesActionsProps {
  labels: { save: string; discard: string; cancel: string }
  isSaving: boolean
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

function UnsavedChangesActions({
  labels,
  isSaving,
  onSave,
  onDiscard,
  onCancel,
}: UnsavedChangesActionsProps) {
  return (
    <div className={styles.actions}>
      <Button type="button" onClick={onCancel} data-testid="btn-cancel-changes">
        {labels.cancel}
      </Button>
      <Button type="button" dangerText onClick={onDiscard} data-testid="btn-discard-changes">
        {labels.discard}
      </Button>
      <Button
        type="button"
        variant="accent"
        onClick={onSave}
        disabled={isSaving}
        data-testid="btn-save-changes"
      >
        {isSaving ? 'Saving...' : labels.save}
      </Button>
    </div>
  )
}

export function UnsavedChangesDialog({
  onSave,
  onDiscard,
  onCancel,
  isSaving: externalIsSaving,
  error: externalError,
  title = 'Unsaved changes',
  message = 'You have unsaved changes on the current row. What would you like to do?',
  saveLabel = 'Save changes',
  discardLabel = 'Discard changes',
  cancelLabel = 'Cancel',
}: UnsavedChangesDialogProps) {
  const { internalSaving, internalError, handleSave } = useUnsavedChangesSave(onSave)
  const isSaving = externalIsSaving ?? internalSaving
  const error = externalError ?? internalError

  return (
    <DialogShell
      isOpen={true}
      onClose={onCancel}
      maxWidth={400}
      testId="unsaved-changes-dialog"
      ariaLabel="Unsaved changes"
      disableFocusManagement={isPlaywrightBuild()}
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

        <UnsavedChangesActions
          labels={{ save: saveLabel, discard: discardLabel, cancel: cancelLabel }}
          isSaving={isSaving}
          onSave={() => void handleSave()}
          onDiscard={onDiscard}
          onCancel={onCancel}
        />
      </div>
    </DialogShell>
  )
}
