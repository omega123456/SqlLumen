import { useState, useEffect, useRef, useCallback } from 'react'
import { X } from '@phosphor-icons/react'
import { useConnectionStore } from '../../stores/connection-store'
import { ConnectionForm } from './ConnectionForm'
import { SavedConnectionsList } from './SavedConnectionsList'
import type { SavedConnection } from '../../types/connection'
import styles from './ConnectionDialog.module.css'

export function ConnectionDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dialogOpen = useConnectionStore((s) => s.dialogOpen)
  const closeDialog = useConnectionStore((s) => s.closeDialog)
  const fetchSavedConnections = useConnectionStore((s) => s.fetchSavedConnections)

  const [editingConnection, setEditingConnection] = useState<SavedConnection | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (dialogOpen) {
      dialog.showModal()
      void fetchSavedConnections()
    } else {
      dialog.close()
    }
  }, [dialogOpen, fetchSavedConnections])

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      setEditingConnection(null)
      closeDialog()
    }
  }

  // Sync store when native dialog closes (e.g., Escape key)
  const handleClose = () => {
    setEditingConnection(null)
    closeDialog()
  }

  const handleCloseButton = useCallback(() => {
    setEditingConnection(null)
    closeDialog()
  }, [closeDialog])

  const handleSelectConnection = useCallback((connection: SavedConnection) => {
    setEditingConnection(connection)
  }, [])

  const handleNewConnection = useCallback(() => {
    setEditingConnection(null)
  }, [])

  const handleDeleteConnection = useCallback(
    (id: string) => {
      if (editingConnection?.id === id) {
        setEditingConnection(null)
      }
    },
    [editingConnection]
  )

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="connection-dialog-title"
      onClick={handleBackdropClick}
      onClose={handleClose}
    >
      <div className={styles.dialogContent}>
        <div className={styles.dialogHeader}>
          <h2 id="connection-dialog-title" className={styles.dialogTitle}>
            Connection Manager
          </h2>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Close dialog"
            onClick={handleCloseButton}
          >
            <X size={20} weight="regular" />
          </button>
        </div>
        <div className={styles.dialogBody}>
          <div className={styles.leftPane}>
            <SavedConnectionsList
              onSelectConnection={handleSelectConnection}
              onNewConnection={handleNewConnection}
              onDeleteConnection={handleDeleteConnection}
              selectedConnectionId={editingConnection?.id ?? null}
            />
          </div>
          <div className={styles.rightPane}>
            <ConnectionForm editingConnection={editingConnection ?? undefined} />
          </div>
        </div>
      </div>
    </dialog>
  )
}
