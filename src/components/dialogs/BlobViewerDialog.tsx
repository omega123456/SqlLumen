/**
 * BlobViewerDialog — shared modal for viewing and editing binary (BLOB) cells.
 *
 * The dialog renders three always-present tabs — Image, Text, Hex — over the
 * cell's working bytes. In `edit` mode it also exposes acquire actions (Load
 * from file, Paste, drag-and-drop), destructive actions (Set NULL, Clear), and
 * an Apply/Cancel footer that stages a self-describing blob envelope. In `view`
 * mode only the tabs, Save-to-file, and Close remain.
 *
 * Byte source: either an injected `loader` (lazy `fetchBlobValue` for the
 * table-data surface) or a pre-supplied `initialBase64` (`null` for SQL NULL)
 * for query-result rows that already inline the bytes. The 10 MB cap only applies to the loader
 * path and to file loads; query-result inlined bytes keep Save-to-file enabled.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  ArrowsOutIcon,
  ClipboardTextIcon,
  DownloadSimpleIcon,
  EraserIcon,
  FileIcon,
  ImageIcon,
  ProhibitIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react'
import { DialogShell } from './DialogShell'
import { UnderlineTabBar } from '../common/UnderlineTabs'
import { Button } from '../common/Button'
import { IconButton } from '../common/IconButton'
import { BlobPastePopover } from './BlobPastePopover'
import {
  base64ToBytes,
  blobTypeLabel,
  bytesToBase64,
  decodeUtf8BestEffort,
  detectBlobExtension,
  envelopeForBytes,
  formatBytes,
  formatHexDump,
  nullEnvelope,
  readImageDimensions,
  sniffImageMime,
} from '../../lib/blob-utils'
import { readFileBytes, writeFileBytes } from '../../lib/table-data-commands'
import { showErrorToast } from '../../stores/toast-store'
import { logFrontend } from '../../lib/app-log-commands'
import type { BlobEnvelope, BlobValueResponse } from '../../types/schema'
import styles from './BlobViewerDialog.module.css'
import { BYTES_PER_MEGABYTE } from '../../lib/units'
import { toErrorMessage } from '../../lib/error-message'
import { isPlaywrightBuild } from '../../lib/tauri-env'

/** Hard cap (10 MB) enforced on file loads inside the dialog. */
const FILE_LOAD_CAP_MEGABYTES = 10
const FILE_LOAD_CAP = FILE_LOAD_CAP_MEGABYTES * BYTES_PER_MEGABYTE
const HEX_DUMP_GROUP_SIZE = 8

type BlobTab = 'image' | 'text' | 'hex'

const TABS: { id: BlobTab; label: string }[] = [
  { id: 'image', label: 'Image' },
  { id: 'text', label: 'Text' },
  { id: 'hex', label: 'Hex' },
]

/**
 * The dialog's working value. `bytes` carries actual content; `null` is a
 * staged SQL NULL; `tooLarge` means no bytes are held (table-data fetch refused
 * them) so content and Save-to-file are suppressed.
 */
type WorkingValue =
  { kind: 'bytes'; bytes: Uint8Array } | { kind: 'null' } | { kind: 'tooLarge'; byteLength: number }

export interface BlobViewerDialogProps {
  isOpen: boolean
  onClose: () => void
  /** `edit` exposes acquire/destructive actions + Apply/Cancel; `view` is read-only. */
  mode: 'edit' | 'view'
  /** Human-readable column name shown in the header (e.g. `photo`). */
  columnLabel: string
  /**
   * Lazy byte source for the table-data surface. Called once on open; manages
   * loading/cap/error states. Mutually exclusive with `initialBase64`.
   */
  loader?: () => Promise<BlobValueResponse>
  /** Pre-supplied base64 bytes (query-result inlined path). `null` for SQL NULL. */
  initialBase64?: string | null
  /** Edit mode: stage the built envelope and close. */
  onApply?: (envelope: BlobEnvelope) => void
}

/** Resolve a `WorkingValue` from a fetched/inlined `BlobValueResponse`. */
function workingFromResponse(response: BlobValueResponse): WorkingValue {
  if (response.tooLarge) {
    return { kind: 'tooLarge', byteLength: response.byteLength }
  }
  if (response.base64 === null) {
    return { kind: 'null' }
  }
  return { kind: 'bytes', bytes: base64ToBytes(response.base64) }
}

const EMPTY_WORKING_VALUE: WorkingValue = { kind: 'bytes', bytes: new Uint8Array(0) }

function decodeInitialBase64(initialBase64: string | null | undefined): WorkingValue {
  if (initialBase64 == null) return { kind: 'null' }
  try {
    return { kind: 'bytes', bytes: base64ToBytes(initialBase64) }
  } catch (error) {
    showErrorToast('Failed to decode BLOB value', toErrorMessage(error))
    return EMPTY_WORKING_VALUE
  }
}

function envelopeForWorkingValue(working: Exclude<WorkingValue, { kind: 'tooLarge' }>) {
  if (working.kind === 'null') return nullEnvelope()
  return envelopeForBytes(working.bytes)
}

function workingBytesOf(working: WorkingValue | null): Uint8Array | null {
  return working?.kind === 'bytes' ? working.bytes : null
}

function panelClassName(isEdit: boolean): string {
  return isEdit ? `${styles.panel} ${styles.panelDroppable}` : styles.panel
}

function workingByteCount(working: WorkingValue | null): number | null {
  if (working?.kind === 'bytes') return working.bytes.length
  if (working?.kind === 'tooLarge') return working.byteLength
  return null
}

function hasByteMetadata(working: WorkingValue | null): boolean {
  return working?.kind === 'bytes' || working?.kind === 'tooLarge'
}

function hasBytes(bytes: Uint8Array | null): bytes is Uint8Array {
  if (!bytes) return false
  return bytes.length > 0
}

function saveButtonTitle(canSave: boolean, tooLarge: boolean): string {
  const isTooLargeToSave = !canSave && tooLarge
  if (isTooLargeToSave) return 'Too large to load — exceeds 10 MB'
  return 'Save bytes to a file'
}

function nextTabIndex(key: string, index: number): number | null {
  const deltaByKey: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 }
  const delta = deltaByKey[key]
  if (delta === undefined) return null
  return (index + delta + TABS.length) % TABS.length
}

interface BytesPanelProps {
  objectUrl: string | null
  columnLabel: string
  textContent: string
  hexRows: ReturnType<typeof formatHexDump>
}

function ImagePanel({ objectUrl, columnLabel }: BytesPanelProps) {
  if (!objectUrl) {
    return (
      <div className={styles.notImageState} data-testid="blob-not-image">
        <ImageIcon size={40} weight="thin" />
        <span className={styles.stateTitle}>Not a valid image</span>
      </div>
    )
  }
  return (
    <div className={styles.imagePanel} data-testid="blob-image">
      <img className={styles.image} src={objectUrl} alt={`${columnLabel} contents`} />
    </div>
  )
}

function TextPanel({ textContent }: BytesPanelProps) {
  return (
    <pre className={styles.textPanel} data-testid="blob-text">
      {textContent}
    </pre>
  )
}

function HexPanel({ hexRows }: BytesPanelProps) {
  return (
    <div className={styles.hexPanel} data-testid="blob-hex">
      {hexRows.map((row) => (
        <div className={styles.hexRow} key={row.offset}>
          <span className={styles.hexOffset}>{row.offset}</span>
          <span className={styles.hexBytes}>
            <span className={styles.hexGroup}>
              {row.hexBytes.slice(0, HEX_DUMP_GROUP_SIZE).join(' ')}
            </span>
            <span className={styles.hexGroup}>
              {row.hexBytes.slice(HEX_DUMP_GROUP_SIZE).join(' ')}
            </span>
          </span>
          <span className={styles.hexAscii}>{row.ascii}</span>
        </div>
      ))}
    </div>
  )
}

const BYTES_PANELS: Record<BlobTab, (props: BytesPanelProps) => ReactElement> = {
  image: ImagePanel,
  text: TextPanel,
  hex: HexPanel,
}

interface BlobPanelBodyProps extends BytesPanelProps {
  loading: boolean
  working: WorkingValue | null
  activeTab: BlobTab
}

function BlobPanelBody({ loading, working, activeTab, ...bytesPanel }: BlobPanelBodyProps) {
  const isAwaitingValue = loading || !working
  if (isAwaitingValue) {
    return (
      <div className={styles.skeleton} data-testid="blob-loading" aria-label="Loading">
        <div className={styles.skeletonBar} />
        <div className={styles.skeletonBar} />
        <div className={styles.skeletonBar} />
      </div>
    )
  }
  if (working.kind === 'tooLarge') {
    return (
      <div className={styles.warningState} data-testid="blob-too-large-content">
        <WarningCircleIcon size={40} weight="thin" />
        <span className={styles.stateTitle}>Preview limit reached</span>
        <span className={styles.stateSub}>
          Exceeds the 10 MB preview limit. Save to file to access the full content.
        </span>
      </div>
    )
  }
  if (working.kind === 'null') {
    return (
      <div className={styles.nullState} data-testid="blob-null-state">
        <ProhibitIcon size={40} weight="thin" />
        <span className={styles.stateTitle}>NULL value</span>
        <span className={styles.stateSub}>This cell contains no data.</span>
      </div>
    )
  }
  if (!hasBytes(working.bytes)) {
    return (
      <div className={styles.emptyState} data-testid="blob-empty-state">
        <EraserIcon size={40} weight="thin" />
        <span className={styles.stateTitle}>Empty — {formatBytes(0)}</span>
      </div>
    )
  }
  const BytesPanel = BYTES_PANELS[activeTab]
  return <BytesPanel {...bytesPanel} />
}

interface SaveToFileButtonProps {
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

function BlobChipRow({ typeLabel, byteCount, tooLarge, dimensions }: BlobChipRowProps) {
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

function BlobEditToolbar(props: BlobEditToolbarProps) {
  const pasteAnchorRef = useRef<HTMLButtonElement>(null)
  return (
    <div className={styles.toolbar} data-testid="blob-action-bar">
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
      <div className={styles.toolbarDivider} aria-hidden="true" />
      <div className={styles.toolbarGroup}>
        <Button
          variant="subtle"
          size="sm"
          dangerText
          onClick={props.onSetNull}
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
          onClick={props.onClear}
          title="Clear to zero bytes"
          aria-label="Clear"
          data-testid="blob-clear"
        >
          <EraserIcon size={16} />
          Clear
        </Button>
      </div>
    </div>
  )
}

interface BlobTabListProps {
  activeTab: BlobTab
  firstTabRef: React.RefObject<HTMLButtonElement | null>
  onSelectTab: (tab: BlobTab) => void
}

function BlobTabList({ activeTab, firstTabRef, onSelectTab }: BlobTabListProps) {
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

function BlobDialogFooter({
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

export function BlobViewerDialog({
  isOpen,
  onClose,
  mode,
  columnLabel,
  loader,
  initialBase64,
  onApply,
}: BlobViewerDialogProps) {
  const [working, setWorking] = useState<WorkingValue | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<BlobTab>('image')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const firstTabRef = useRef<HTMLButtonElement>(null)
  const dragDepth = useRef(0)

  // -- Initialise working value on open ------------------------------------
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setActiveTab('image')
    setPasteOpen(false)
    setDragOver(false)
    dragDepth.current = 0

    if (!loader) {
      setWorking(decodeInitialBase64(initialBase64))
      return
    }
    setLoading(true)
    setWorking(null)
    loader()
      .then((response) => {
        if (cancelled) return
        setWorking(workingFromResponse(response))
      })
      .catch((error) => {
        if (cancelled) return
        showErrorToast('Failed to load BLOB value', toErrorMessage(error))
        setWorking(EMPTY_WORKING_VALUE)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, loader, initialBase64])

  // -- Focus the active tab on open ----------------------------------------
  useEffect(() => {
    if (!isOpen) return
    if (isPlaywrightBuild()) return
    const id = requestAnimationFrame(() => {
      firstTabRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [isOpen])

  // -- Object URL lifecycle for the Image tab ------------------------------
  const workingBytes = workingBytesOf(working)
  const imageMime = useMemo(
    () => (hasBytes(workingBytes) ? sniffImageMime(workingBytes) : null),
    [workingBytes]
  )
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  useEffect(() => {
    const hasNoImage = !workingBytes || !imageMime
    if (hasNoImage) {
      setObjectUrl(null)
      return
    }
    const url = URL.createObjectURL(new Blob([workingBytes.slice().buffer], { type: imageMime }))
    setObjectUrl(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [workingBytes, imageMime])

  // -- Derived content ------------------------------------------------------
  const textContent = useMemo(
    () => (workingBytes ? decodeUtf8BestEffort(workingBytes) : ''),
    [workingBytes]
  )
  const hexRows = useMemo(() => (workingBytes ? formatHexDump(workingBytes) : []), [workingBytes])

  // -- Derived metadata chips ----------------------------------------------
  const typeLabel = useMemo(
    () => (workingBytes ? blobTypeLabel(workingBytes) : null),
    [workingBytes]
  )
  const dimensions = useMemo(
    () => (hasBytes(workingBytes) ? readImageDimensions(workingBytes) : null),
    [workingBytes]
  )

  const isEdit = mode === 'edit'
  const tooLarge = working?.kind === 'tooLarge'
  const canSave = working?.kind === 'bytes'

  // -- Acquire actions ------------------------------------------------------
  const applyBytes = useCallback((bytes: Uint8Array) => {
    setWorking({ kind: 'bytes', bytes: bytes })
    setPasteOpen(false)
  }, [])

  const handleLoadFromFile = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ multiple: false, directory: false })
      if (typeof selected !== 'string') return
      const base64 = await readFileBytes(selected)
      const bytes = base64ToBytes(base64)
      if (bytes.length > FILE_LOAD_CAP) {
        showErrorToast('File too large', 'The selected file exceeds the 10 MB limit.')
        return
      }
      applyBytes(bytes)
    } catch (error) {
      const message = toErrorMessage(error)
      logFrontend('error', `[blob-viewer] load from file failed: ${message}`)
      showErrorToast('Failed to load file', message)
    }
  }, [applyBytes])

  const handleSetNull = useCallback(() => {
    setWorking({ kind: 'null' })
    setPasteOpen(false)
  }, [])

  const handleClear = useCallback(() => {
    applyBytes(new Uint8Array(0))
  }, [applyBytes])

  // -- Apply / save ---------------------------------------------------------
  const handleApply = useCallback(() => {
    if (!onApply) return
    if (!working) return
    if (working.kind !== 'tooLarge') {
      onApply(envelopeForWorkingValue(working))
    }
    onClose()
  }, [onApply, working, onClose])

  const handleSaveToFile = useCallback(async () => {
    if (working?.kind !== 'bytes') return
    const bytes = working.bytes
    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const ext = detectBlobExtension(bytes)
      const selected = await save({
        defaultPath: `${columnLabel || 'blob'}${ext}`,
        filters: [{ name: 'Binary', extensions: [ext.replace(/^\./, '')] }],
      })
      if (typeof selected !== 'string') return
      await writeFileBytes(selected, bytesToBase64(bytes))
    } catch (error) {
      const message = toErrorMessage(error)
      logFrontend('error', `[blob-viewer] save to file failed: ${message}`)
      showErrorToast('Failed to save file', message)
    }
  }, [working, columnLabel])

  // -- Drag and drop --------------------------------------------------------
  const handleDragEnter = useCallback(
    (event: React.DragEvent) => {
      if (!isEdit) return
      event.preventDefault()
      dragDepth.current += 1
      setDragOver(true)
    },
    [isEdit]
  )

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      if (!isEdit) return
      event.preventDefault()
    },
    [isEdit]
  )

  const handleDragLeave = useCallback(
    (event: React.DragEvent) => {
      if (!isEdit) return
      event.preventDefault()
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragOver(false)
    },
    [isEdit]
  )

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      if (!isEdit) return
      event.preventDefault()
      dragDepth.current = 0
      setDragOver(false)
      const file = event.dataTransfer.files?.[0]
      if (!file) return
      try {
        const buffer = await file.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        if (bytes.length > FILE_LOAD_CAP) {
          showErrorToast('File too large', 'The dropped file exceeds the 10 MB limit.')
          return
        }
        applyBytes(bytes)
      } catch (error) {
        const message = toErrorMessage(error)
        logFrontend('error', `[blob-viewer] drop failed: ${message}`)
        showErrorToast('Failed to read dropped file', message)
      }
    },
    [isEdit, applyBytes]
  )

  // -- Keyboard: ESC cancels drag before closing ---------------------------
  const handleClose = useCallback(() => {
    if (dragOver) {
      dragDepth.current = 0
      setDragOver(false)
      return
    }
    onClose()
  }, [dragOver, onClose])

  if (!isOpen) return null

  const saveButton: SaveToFileButtonProps = {
    canSave: canSave,
    tooLarge: tooLarge,
    onSave: handleSaveToFile,
  }

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={handleClose}
      panelWidth="min(90vw, 800px)"
      panelHeight="min(90vh, 600px)"
      panelPadding={false}
      testId="blob-viewer-dialog"
      ariaLabel={`BLOB — ${columnLabel}`}
      disableFocusManagement={isPlaywrightBuild()}
    >
      <div
        className={styles.root}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-testid="blob-viewer-root"
      >
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>
            BLOB · <code className={styles.columnName}>{columnLabel}</code>
          </h2>
          <div className={styles.headerActions}>
            {!isEdit && <SaveToFileButton {...saveButton} />}
            <IconButton
              aria-label="Close"
              title="Close"
              onClick={handleClose}
              data-testid="blob-close"
            >
              <XIcon size={16} weight="bold" />
            </IconButton>
          </div>
        </div>

        {!loading && hasByteMetadata(working) && (
          <BlobChipRow
            typeLabel={typeLabel}
            byteCount={workingByteCount(working)}
            tooLarge={tooLarge}
            dimensions={dimensions}
          />
        )}

        {isEdit && (
          <BlobEditToolbar
            saveButton={saveButton}
            pasteOpen={pasteOpen}
            onTogglePaste={() => setPasteOpen((isPasteOpen) => !isPasteOpen)}
            onClosePaste={() => setPasteOpen(false)}
            onApplyBytes={applyBytes}
            onLoadFromFile={handleLoadFromFile}
            onSetNull={handleSetNull}
            onClear={handleClear}
          />
        )}

        <BlobTabList activeTab={activeTab} firstTabRef={firstTabRef} onSelectTab={setActiveTab} />

        {/* Panel */}
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
            objectUrl={objectUrl}
            columnLabel={columnLabel}
            textContent={textContent}
            hexRows={hexRows}
          />
        </div>

        <BlobDialogFooter isEdit={isEdit} onApply={handleApply} onClose={onClose} />

        {/* Drag overlay */}
        {isEdit && dragOver && (
          <div className={styles.dropOverlay} data-testid="blob-drop-overlay">
            <UploadSimpleIcon size={40} weight="bold" />
            <span>Drop to load</span>
          </div>
        )}
      </div>
    </DialogShell>
  )
}
