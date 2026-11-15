import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { Plug, X } from '@phosphor-icons/react'
import { IconButton } from '../common/IconButton'
import { useConnectionStore } from '../../stores/connection-store'
import { ConnectionForm } from './ConnectionForm'
import { SavedConnectionsList } from './SavedConnectionsList'
import { useEditorTarget } from './connection-dialog/use-editor-target'

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
    <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-light-stroke-divider pr-2 pl-4 text-light-on-surface dark:border-dark-stroke-divider dark:text-dark-on-surface">
      <Plug size={HEADER_ICON_SIZE} weight="regular" aria-hidden />
      <h2
        id="connection-dialog-title"
        className="flex-1 font-body text-caption font-regular text-light-on-surface dark:text-dark-on-surface"
      >
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
      className="fixed inset-0 m-auto h-connection-dialog-height max-h-viewport-inset-height w-connection-dialog-width max-w-viewport-inset-width overflow-hidden rounded-overlay border border-light-stroke-flyout bg-light-surface-container-high p-0 text-light-on-surface shadow-light-dialog backdrop:bg-light-smoke dark:border-dark-stroke-flyout dark:bg-dark-surface-container-high dark:text-dark-on-surface dark:shadow-dark-dialog dark:backdrop:bg-dark-smoke"
      data-testid="connection-dialog"
      aria-labelledby="connection-dialog-title"
      onClick={handleBackdropClick}
      onClose={handleClose}
    >
      <div className="flex h-full min-h-0 flex-col">
        <ConnectionDialogHeader onClose={handleClose} />
        <div className="grid min-h-0 flex-1 grid-cols-connection-body grid-rows-connection-body">
          <aside
            className="col-start-1 row-start-1 flex min-h-0 flex-col border-r border-light-stroke-divider bg-light-surface dark:border-dark-stroke-divider dark:bg-dark-surface"
            data-testid="saved-connections-pane"
          >
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
