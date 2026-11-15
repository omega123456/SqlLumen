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
import { joinClassNames } from '../../../lib/class-names'
import { DIALOG_HEADER_TITLE, DIALOG_PANEL_FOOTER } from '../../../lib/class-names-dialog'

type ChipTone = 'neutral' | 'warning'

const CHIP_TONE_CLASSES: Record<ChipTone, string> = {
  neutral:
    'border-light-stroke-card bg-light-fill-neutral-selected text-light-on-surface-variant dark:border-dark-stroke-card dark:bg-dark-fill-neutral-selected dark:text-dark-on-surface-variant',
  warning:
    'border-light-warning bg-light-warning-container text-light-warning dark:border-dark-warning dark:bg-dark-warning-container dark:text-dark-warning',
}

function chipClassName(tone: ChipTone): string {
  return joinClassNames([
    'inline-flex items-center gap-1 rounded-control border px-2 py-1 font-mono text-size-caption whitespace-nowrap',
    CHIP_TONE_CLASSES[tone],
  ])
}

type TabState = 'idle' | 'active'

const TAB_STATE_CLASSES: Record<TabState, string> = {
  idle: 'border-b-transparent text-light-on-surface-variant dark:text-dark-on-surface-variant',
  active:
    'border-b-light-primary text-light-primary dark:border-b-dark-primary dark:text-dark-primary',
}

function tabClassName(selected: boolean): string {
  const state: TabState = selected ? 'active' : 'idle'
  return joinClassNames([
    'cursor-pointer appearance-none border-b-2 bg-transparent px-3 py-2 text-size-caption font-regular transition-color-and-border-color hover:text-light-on-surface dark:hover:text-dark-on-surface',
    TAB_STATE_CLASSES[state],
  ])
}

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
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-2"
      data-testid="blob-chip-row"
    >
      {typeLabel && (
        <span className={chipClassName('neutral')} data-testid="blob-chip-type">
          <FileIcon size={12} />
          {typeLabel}
        </span>
      )}
      {byteCount != null && (
        <span
          className={chipClassName(tooLarge ? 'warning' : 'neutral')}
          role={tooLarge ? 'alert' : undefined}
          data-testid="blob-chip-size"
        >
          {tooLarge && <WarningCircleIcon size={12} weight="fill" />}
          {formatBytes(byteCount)}
        </span>
      )}
      {dimensions && (
        <span className={chipClassName('neutral')} data-testid="blob-chip-dimensions">
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
    <div className="flex items-center gap-1">
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
      <div className="relative inline-flex">
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
    <div className="flex items-center gap-1">
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
    <div
      className="flex shrink-0 items-center gap-2 border-b border-light-stroke-divider px-4 py-2 dark:border-dark-stroke-divider"
      data-testid="blob-action-bar"
    >
      <BlobAcquireActions {...props} />
      <div
        className="mr-1 ml-auto w-px self-stretch bg-light-outline-variant opacity-50 dark:bg-dark-outline-variant"
        aria-hidden="true"
      />
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
      <div role="tablist" aria-label="BLOB views" className="flex w-full items-stretch gap-1">
        {TABS.map((tab, index) => {
          const selected = activeTab === tab.id
          return (
            <Button
              variant="bare"
              key={tab.id}
              ref={index === 0 ? firstTabRef : undefined}
              className={tabClassName(selected)}
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
      <div className={DIALOG_PANEL_FOOTER}>
        <Button variant="accent" onClick={onClose} data-testid="blob-close-footer">
          Close
        </Button>
      </div>
    )
  }
  return (
    <div className={DIALOG_PANEL_FOOTER}>
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
    <div className="flex shrink-0 items-center justify-between gap-3 px-6 pt-6">
      <h2 className={joinClassNames([DIALOG_HEADER_TITLE, 'min-w-0 truncate'])}>
        BLOB ·{' '}
        <code className="font-mono text-light-primary dark:text-dark-primary">{columnLabel}</code>
      </h2>
      <div className="flex shrink-0 items-center gap-2">
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
    <div
      className="pointer-events-none absolute inset-0 z-5 flex flex-col items-center justify-center gap-3 rounded-overlay border-2 border-dashed border-light-primary bg-light-fill-accent-tint text-size-caption font-semibold text-light-primary dark:border-dark-primary dark:bg-dark-fill-accent-tint dark:text-dark-primary"
      data-testid="blob-drop-overlay"
    >
      <UploadSimpleIcon size={40} weight="bold" />
      <span>Drop to load</span>
    </div>
  )
}
