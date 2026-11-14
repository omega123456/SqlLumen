import { useRef } from 'react'
import {
  ArrowsOutIcon,
  ClipboardTextIcon,
  DownloadSimpleIcon,
  EraserIcon,
  FileIcon,
  ProhibitIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react'
import { UnderlineTabBar } from '../../common/UnderlineTabs'
import { Button } from '../../common/Button'
import { IconButton } from '../../common/IconButton'
import { BlobPastePopover } from '../BlobPastePopover'
import { formatBytes, readImageDimensions } from '../../../lib/blob-utils'
import { showErrorToast } from '../../../stores/toast-store'
import { TABS, nextTabIndex, saveButtonTitle, type BlobTab } from './blob-working-value'
import styles from '../BlobViewerDialog.module.css'

export interface SaveToFileButtonProps {
  canSave: boolean
  tooLarge: boolean
  onSave: () => void
}

function SaveToFileButton({ canSave, tooLarge, onSave }: SaveToFileButtonProps) {
  return (
    <Button
      variant="subtle"
      size="sm"
      onClick={onSave}
      disabled={!canSave}
      title={saveButtonTitle(canSave, tooLarge)}
      aria-label="Save to file"
      data-testid="blob-save-file"
    >
      <DownloadSimpleIcon size={16} />
      Save to file
    </Button>
  )
}

interface BlobChipRowProps {
  typeLabel: string | null
  byteCount: number | null
  tooLarge: boolean
  dimensions: ReturnType<typeof readImageDimensions>
}

export function BlobChipRow({ typeLabel, byteCount, tooLarge, dimensions }: BlobChipRowProps) {
  return (
    <div className={styles.chipRow} data-testid="blob-chip-row">
      {typeLabel && (
        <span className={styles.chip} data-testid="blob-chip-type">
          <FileIcon size={12} />
          {typeLabel}
        </span>
      )}
      {byteCount != null && (
        <span
          className={tooLarge ? `${styles.chip} ${styles.chipWarning}` : styles.chip}
          role={tooLarge ? 'alert' : undefined}
          data-testid="blob-chip-size"
        >
          {tooLarge && <WarningCircleIcon size={12} weight="fill" />}
          {formatBytes(byteCount)}
        </span>
      )}
      {dimensions && (
        <span className={styles.chip} data-testid="blob-chip-dimensions">
          <ArrowsOutIcon size={12} />
          {dimensions.width} × {dimensions.height}
        </span>
      )}
    </div>
  )
}

interface BlobEditToolbarProps {
  saveButton: SaveToFileButtonProps
  pasteOpen: boolean
  onTogglePaste: () => void
  onClosePaste: () => void
  onApplyBytes: (bytes: Uint8Array) => void
  onLoadFromFile: () => void
  onSetNull: () => void
  onClear: () => void
}

function BlobAcquireActions(props: BlobEditToolbarProps) {
  const pasteAnchorRef = useRef<HTMLButtonElement>(null)
  return (
    <div className={styles.toolbarGroup}>
      <Button
        variant="subtle"
        size="sm"
        onClick={props.onLoadFromFile}
        title="Load bytes from a file"
        aria-label="Load file"
        data-testid="blob-load-file"
      >
        <UploadSimpleIcon size={16} />
        Load file
      </Button>
      <div className={styles.pasteAnchor}>
        <Button
          ref={pasteAnchorRef}
          variant="subtle"
          size="sm"
          onClick={props.onTogglePaste}
          title="Paste base64 or hex"
          aria-label="Paste"
          data-testid="blob-paste-toggle"
        >
          <ClipboardTextIcon size={16} />
          Paste
        </Button>
        <BlobPastePopover
          isOpen={props.pasteOpen}
          onClose={props.onClosePaste}
          onApply={props.onApplyBytes}
          onError={(message) => showErrorToast('Could not parse pasted data', message)}
          anchorRef={pasteAnchorRef}
        />
      </div>
      <SaveToFileButton {...props.saveButton} />
    </div>
  )
}

function BlobDestructiveActions({ onSetNull, onClear }: BlobEditToolbarProps) {
  return (
    <div className={styles.toolbarGroup}>
      <Button
        variant="subtle"
        size="sm"
        dangerText
        onClick={onSetNull}
        title="Stage a SQL NULL value"
        aria-label="Set NULL"
        data-testid="blob-set-null"
      >
        <ProhibitIcon size={16} />
        Set NULL
      </Button>
      <Button
        variant="subtle"
        size="sm"
        dangerText
        onClick={onClear}
        title="Clear to zero bytes"
        aria-label="Clear"
        data-testid="blob-clear"
      >
        <EraserIcon size={16} />
        Clear
      </Button>
    </div>
  )
}

export function BlobEditToolbar(props: BlobEditToolbarProps) {
  return (
    <div className={styles.toolbar} data-testid="blob-action-bar">
      <BlobAcquireActions {...props} />
      <div className={styles.toolbarDivider} aria-hidden="true" />
      <BlobDestructiveActions {...props} />
    </div>
  )
}

interface BlobTabListProps {
  activeTab: BlobTab
  firstTabRef: React.RefObject<HTMLButtonElement | null>
  onSelectTab: (tab: BlobTab) => void
}

export function BlobTabList({ activeTab, firstTabRef, onSelectTab }: BlobTabListProps) {
  const handleTabKeyDown = (event: React.KeyboardEvent, index: number) => {
    const nextIndex = nextTabIndex(event.key, index)
    if (nextIndex === null) return
    event.preventDefault()
    onSelectTab(TABS[nextIndex].id)
  }
  return (
    <UnderlineTabBar data-testid="blob-tabs">
      <div role="tablist" aria-label="BLOB views" className={styles.tablist}>
        {TABS.map((tab, index) => {
          const selected = activeTab === tab.id
          const tabClass = selected ? `${styles.tab} ${styles.tabActive}` : styles.tab
          return (
            <Button
              variant="bare"
              key={tab.id}
              ref={index === 0 ? firstTabRef : undefined}
              className={tabClass}
              onClick={() => onSelectTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              role="tab"
              aria-selected={selected}
              aria-controls={`blob-panel-${tab.id}`}
              id={`blob-tab-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              data-testid={`blob-tab-${tab.id}`}
            >
              {tab.label}
            </Button>
          )
        })}
      </div>
    </UnderlineTabBar>
  )
}

export function BlobDialogFooter({
  isEdit,
  onApply,
  onClose,
}: {
  isEdit: boolean
  onApply: () => void
  onClose: () => void
}) {
  if (!isEdit) {
    return (
      <div className={styles.footer}>
        <Button variant="accent" onClick={onClose} data-testid="blob-close-footer">
          Close
        </Button>
      </div>
    )
  }
  return (
    <div className={styles.footer}>
      <Button variant="accent" onClick={onApply} data-testid="blob-apply">
        Apply
      </Button>
      <Button onClick={onClose} data-testid="blob-cancel">
        Cancel
      </Button>
    </div>
  )
}

interface BlobDialogHeaderProps {
  columnLabel: string
  isEdit: boolean
  saveButton: SaveToFileButtonProps
  onClose: () => void
}

export function BlobDialogHeader({
  columnLabel,
  isEdit,
  saveButton,
  onClose,
}: BlobDialogHeaderProps) {
  return (
    <div className={styles.header}>
      <h2 className={styles.title}>
        BLOB · <code className={styles.columnName}>{columnLabel}</code>
      </h2>
      <div className={styles.headerActions}>
        {!isEdit && <SaveToFileButton {...saveButton} />}
        <IconButton aria-label="Close" title="Close" onClick={onClose} data-testid="blob-close">
          <XIcon size={16} weight="bold" />
        </IconButton>
      </div>
    </div>
  )
}

export function BlobDropOverlay({ isVisible }: { isVisible: boolean }) {
  if (!isVisible) return null
  return (
    <div className={styles.dropOverlay} data-testid="blob-drop-overlay">
      <UploadSimpleIcon size={40} weight="bold" />
      <span>Drop to load</span>
    </div>
  )
}
