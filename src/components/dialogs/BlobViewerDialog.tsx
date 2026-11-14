import { DialogShell } from './DialogShell'
import type { BlobEnvelope, BlobValueResponse } from '../../types/schema'
import styles from './BlobViewerDialog.module.css'
import { isPlaywrightBuild } from '../../lib/tauri-env'
import {
  hasByteMetadata,
  workingByteCount,
  type BlobTab,
  type WorkingValue,
} from './blob-viewer-dialog/blob-working-value'
import {
  BlobChipRow,
  BlobDialogFooter,
  BlobDialogHeader,
  BlobDropOverlay,
  BlobEditToolbar,
  BlobTabList,
  type SaveToFileButtonProps,
} from './blob-viewer-dialog/BlobDialogParts'
import { BlobPanelBody } from './blob-viewer-dialog/BlobPanels'
import { useBlobActions, useBlobDragAndDrop } from './blob-viewer-dialog/use-blob-actions'
import { useBlobContent, useBlobViewerSession } from './blob-viewer-dialog/use-blob-viewer-session'

export interface BlobViewerDialogProps {
  isOpen: boolean
  onClose: () => void
  mode: 'edit' | 'view'
  columnLabel: string
  loader?: () => Promise<BlobValueResponse>
  initialBase64?: string | null
  onApply?: (envelope: BlobEnvelope) => void
}

function panelClassName(isEdit: boolean): string {
  return isEdit ? `${styles.panel} ${styles.panelDroppable}` : styles.panel
}

interface BlobContentAreaProps {
  isEdit: boolean
  loading: boolean
  working: WorkingValue | null
  activeTab: BlobTab
  columnLabel: string
  content: ReturnType<typeof useBlobContent>
}

function BlobContentArea({
  isEdit,
  loading,
  working,
  activeTab,
  columnLabel,
  content,
}: BlobContentAreaProps) {
  return (
    <div
      className={panelClassName(isEdit)}
      role="tabpanel"
      id={`blob-panel-${activeTab}`}
      aria-labelledby={`blob-tab-${activeTab}`}
      data-testid="blob-panel"
    >
      <BlobPanelBody
        loading={loading}
        working={working}
        activeTab={activeTab}
        objectUrl={content.objectUrl}
        columnLabel={columnLabel}
        textContent={content.textContent}
        hexRows={content.hexRows}
      />
    </div>
  )
}

interface BlobEditActionsProps {
  saveButton: SaveToFileButtonProps
  pasteOpen: boolean
  setPasteOpen: (update: (isPasteOpen: boolean) => boolean) => void
  actions: ReturnType<typeof useBlobActions>
}

function BlobEditActions({ saveButton, pasteOpen, setPasteOpen, actions }: BlobEditActionsProps) {
  return (
    <BlobEditToolbar
      saveButton={saveButton}
      pasteOpen={pasteOpen}
      onTogglePaste={() => setPasteOpen((isPasteOpen) => !isPasteOpen)}
      onClosePaste={() => setPasteOpen(() => false)}
      onApplyBytes={actions.applyBytes}
      onLoadFromFile={actions.handleLoadFromFile}
      onSetNull={actions.handleSetNull}
      onClear={actions.handleClear}
    />
  )
}

interface BlobMetadataChipsProps {
  loading: boolean
  working: WorkingValue | null
  content: ReturnType<typeof useBlobContent>
}

function BlobMetadataChips({ loading, working, content }: BlobMetadataChipsProps) {
  if (loading) return null
  if (!hasByteMetadata(working)) return null
  return (
    <BlobChipRow
      typeLabel={content.typeLabel}
      byteCount={workingByteCount(working)}
      tooLarge={working?.kind === 'tooLarge'}
      dimensions={content.dimensions}
    />
  )
}

function useBlobViewerDialog(props: BlobViewerDialogProps) {
  const { columnLabel, onApply, onClose } = props
  const isEdit = props.mode === 'edit'
  const { state, dragDepth, firstTabRef } = useBlobViewerSession(props)
  const content = useBlobContent(state.working)
  const actions = useBlobActions({
    session: state,
    columnLabel: columnLabel,
    onApply: onApply,
    onClose: onClose,
  })
  const drag = useBlobDragAndDrop({
    session: state,
    dragDepth: dragDepth,
    isEdit: isEdit,
    applyBytes: actions.applyBytes,
    onClose: onClose,
  })
  const saveButton: SaveToFileButtonProps = {
    canSave: state.working?.kind === 'bytes',
    tooLarge: state.working?.kind === 'tooLarge',
    onSave: actions.handleSaveToFile,
  }
  return { isEdit, state, firstTabRef, content, actions, drag, saveButton }
}

export function BlobViewerDialog(props: BlobViewerDialogProps) {
  const { isOpen, onClose, columnLabel } = props
  const { firstTabRef, isEdit, state, content, actions, drag, saveButton } =
    useBlobViewerDialog(props)
  const { working, loading, activeTab, pasteOpen, setPasteOpen } = state
  if (!isOpen) return null

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={drag.handleClose}
      panelWidth="min(90vw, 800px)"
      panelHeight="min(90vh, 600px)"
      panelPadding={false}
      testId="blob-viewer-dialog"
      ariaLabel={`BLOB — ${columnLabel}`}
      disableFocusManagement={isPlaywrightBuild()}
    >
      <div
        className={styles.root}
        onDragEnter={drag.handleDragEnter}
        onDragOver={drag.handleDragOver}
        onDragLeave={drag.handleDragLeave}
        onDrop={drag.handleDrop}
        data-testid="blob-viewer-root"
      >
        <BlobDialogHeader
          columnLabel={columnLabel}
          isEdit={isEdit}
          saveButton={saveButton}
          onClose={drag.handleClose}
        />
        <BlobMetadataChips loading={loading} working={working} content={content} />
        {isEdit && (
          <BlobEditActions
            saveButton={saveButton}
            pasteOpen={pasteOpen}
            setPasteOpen={setPasteOpen}
            actions={actions}
          />
        )}
        <BlobTabList
          activeTab={activeTab}
          firstTabRef={firstTabRef}
          onSelectTab={state.setActiveTab}
        />
        <BlobContentArea
          isEdit={isEdit}
          loading={loading}
          working={working}
          activeTab={activeTab}
          columnLabel={columnLabel}
          content={content}
        />
        <BlobDialogFooter isEdit={isEdit} onApply={actions.handleApply} onClose={onClose} />
        <BlobDropOverlay isVisible={isEdit && state.dragOver} />
      </div>
    </DialogShell>
  )
}
