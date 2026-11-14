import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { Plug, X } from '@phosphor-icons/react'
import { IconButton } from '../common/IconButton'
import { useConnectionStore } from '../../stores/connection-store'
import { ConnectionForm } from './ConnectionForm'
import { SavedConnectionsList } from './SavedConnectionsList'
import { useEditorTarget } from './connection-dialog/use-editor-target'
import styles from './ConnectionDialog.module.css'

const HEADER_ICON_SIZE = 16

function useModalVisibility(dialogRef: RefObject<HTMLDialogElement | null>) {
  const dialogOpen = useConnectionStore((state) => state.dialogOpen)
  const fetchSavedConnections = useConnectionStore((state) => state.fetchSavedConnections)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (!dialogOpen) {
      dialog.close()
      return
    }
    dialog.showModal()
    void fetchSavedConnections()
  }, [dialogOpen, dialogRef, fetchSavedConnections])
}

function ConnectionDialogHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.dialogHeader}>
      <Plug size={HEADER_ICON_SIZE} weight="regular" aria-hidden />
      <h2 id="connection-dialog-title" className={styles.dialogTitle}>
        Connection manager
      </h2>
      <IconButton aria-label="Close dialog" title="Close" onClick={onClose}>
        <X size={HEADER_ICON_SIZE} weight="regular" />
      </IconButton>
    </div>
  )
}

export function ConnectionDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeDialog = useConnectionStore((state) => state.closeDialog)
  const editor = useEditorTarget()
  const { editingConnection, duplicateSeed } = editor.target
  const resetEditor = editor.reset
  useModalVisibility(dialogRef)

  const handleClose = useCallback(() => {
    resetEditor()
    closeDialog()
  }, [closeDialog, resetEditor])

  const handleBackdropClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialogRef.current) {
      handleClose()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      data-testid="connection-dialog"
      aria-labelledby="connection-dialog-title"
      onClick={handleBackdropClick}
      onClose={handleClose}
    >
      <div className={styles.dialogContent}>
        <ConnectionDialogHeader onClose={handleClose} />
        <div className={styles.dialogBody}>
          <aside className={styles.leftPane} data-testid="saved-connections-pane">
            <SavedConnectionsList
              onSelectConnection={editor.select}
              onNewConnection={resetEditor}
              onDuplicateConnection={editor.duplicate}
              selectedConnectionId={editingConnection?.id ?? null}
            />
          </aside>
          <ConnectionForm
            editingConnection={editingConnection ?? undefined}
            onDeleteConnection={editor.forgetDeleted}
            initialData={duplicateSeed ?? undefined}
          />
        </div>
      </div>
    </dialog>
  )
}
