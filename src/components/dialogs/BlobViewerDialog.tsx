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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ClipboardTextIcon,
  DownloadSimpleIcon,
  EraserIcon,
  ProhibitIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react'
import { DialogShell } from './DialogShell'
import { UnderlineTabBar } from '../common/UnderlineTabs'
import { Button } from '../common/Button'
import { IconButton } from '../common/IconButton'
import { Textarea } from '../common/Textarea'
import {
  base64ToBytes,
  bytesToBase64,
  bytesEnvelope,
  decodeUtf8BestEffort,
  detectBlobExtension,
  emptyEnvelope,
  formatHexDump,
  nullEnvelope,
  parsePastedBytes,
  sniffImageMime,
} from '../../lib/blob-utils'
import { readFileBytes, writeFileBytes } from '../../lib/table-data-commands'
import { showErrorToast } from '../../stores/toast-store'
import { logFrontend } from '../../lib/app-log-commands'
import type { BlobEnvelope, BlobValueResponse } from '../../types/schema'
import styles from './BlobViewerDialog.module.css'

const isPlaywright = import.meta.env.VITE_PLAYWRIGHT === 'true'

/** Hard cap (10 MB) enforced on file loads inside the dialog. */
const FILE_LOAD_CAP = 10 * 1024 * 1024

type BlobTab = 'image' | 'text' | 'hex'

const TABS: { id: BlobTab; label: string }[] = [
  { id: 'image', label: 'Image' },
  { id: 'text', label: 'Text' },
  { id: 'hex', label: 'Hex' },
]

/** Extract a human-readable message from an unknown thrown value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * The dialog's working value. `bytes` carries actual content; `null` is a
 * staged SQL NULL; `tooLarge` means no bytes are held (table-data fetch refused
 * them) so content and Save-to-file are suppressed.
 */
type WorkingValue =
  | { kind: 'bytes'; bytes: Uint8Array }
  | { kind: 'null' }
  | { kind: 'tooLarge'; byteLength: number }

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
  const [pasteText, setPasteText] = useState('')
  const [dragOver, setDragOver] = useState(false)

  const firstTabRef = useRef<HTMLButtonElement>(null)
  const dragDepth = useRef(0)

  // -- Initialise working value on open ------------------------------------
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setActiveTab('image')
    setPasteOpen(false)
    setPasteText('')
    setDragOver(false)
    dragDepth.current = 0

    if (loader) {
      setLoading(true)
      setWorking(null)
      loader()
        .then((response) => {
          if (cancelled) return
          setWorking(workingFromResponse(response))
        })
        .catch((err) => {
          if (cancelled) return
          const msg = errorMessage(err)
          showErrorToast('Failed to load BLOB value', msg)
          setWorking({ kind: 'bytes', bytes: new Uint8Array(0) })
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    } else if (initialBase64 == null) {
      setWorking({ kind: 'null' })
    } else {
      try {
        setWorking({ kind: 'bytes', bytes: base64ToBytes(initialBase64) })
      } catch (err) {
        const msg = errorMessage(err)
        showErrorToast('Failed to decode BLOB value', msg)
        setWorking({ kind: 'bytes', bytes: new Uint8Array(0) })
      }
    }
    return () => {
      cancelled = true
    }
  }, [isOpen, loader, initialBase64])

  // -- Focus the active tab on open ----------------------------------------
  useEffect(() => {
    if (!isOpen || isPlaywright) return
    const id = requestAnimationFrame(() => {
      firstTabRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [isOpen])

  // -- Object URL lifecycle for the Image tab ------------------------------
  const workingBytes = working?.kind === 'bytes' ? working.bytes : null
  const imageMime = useMemo(
    () => (workingBytes && workingBytes.length > 0 ? sniffImageMime(workingBytes) : null),
    [workingBytes]
  )
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!workingBytes || !imageMime) {
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

  const isEdit = mode === 'edit'
  const tooLarge = working?.kind === 'tooLarge'
  const canSave = working?.kind === 'bytes'

  // -- Acquire actions ------------------------------------------------------
  const applyBytes = useCallback((bytes: Uint8Array) => {
    setWorking({ kind: 'bytes', bytes })
    setPasteOpen(false)
    setPasteText('')
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
    } catch (err) {
      const msg = errorMessage(err)
      logFrontend('error', `[blob-viewer] load from file failed: ${msg}`)
      showErrorToast('Failed to load file', msg)
    }
  }, [applyBytes])

  const handleApplyPaste = useCallback(() => {
    const result = parsePastedBytes(pasteText)
    if (!result.ok) {
      showErrorToast('Could not parse pasted data', result.error)
      return
    }
    applyBytes(result.bytes)
  }, [pasteText, applyBytes])

  const handleSetNull = useCallback(() => {
    setWorking({ kind: 'null' })
    setPasteOpen(false)
    setPasteText('')
  }, [])

  const handleClear = useCallback(() => {
    applyBytes(new Uint8Array(0))
  }, [applyBytes])

  // -- Apply / save ---------------------------------------------------------
  const handleApply = useCallback(() => {
    if (!onApply || !working) return
    let envelope: BlobEnvelope
    if (working.kind === 'null') {
      envelope = nullEnvelope()
    } else if (working.kind === 'tooLarge') {
      // No bytes held — nothing to apply; just close.
      onClose()
      return
    } else if (working.bytes.length === 0) {
      envelope = emptyEnvelope()
    } else {
      envelope = bytesEnvelope(bytesToBase64(working.bytes))
    }
    onApply(envelope)
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
    } catch (err) {
      const msg = errorMessage(err)
      logFrontend('error', `[blob-viewer] save to file failed: ${msg}`)
      showErrorToast('Failed to save file', msg)
    }
  }, [working, columnLabel])

  // -- Drag and drop --------------------------------------------------------
  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!isEdit) return
      e.preventDefault()
      dragDepth.current += 1
      setDragOver(true)
    },
    [isEdit]
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!isEdit) return
      e.preventDefault()
    },
    [isEdit]
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!isEdit) return
      e.preventDefault()
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragOver(false)
    },
    [isEdit]
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!isEdit) return
      e.preventDefault()
      dragDepth.current = 0
      setDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (!file) return
      try {
        const buffer = await file.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        if (bytes.length > FILE_LOAD_CAP) {
          showErrorToast('File too large', 'The dropped file exceeds the 10 MB limit.')
          return
        }
        applyBytes(bytes)
      } catch (err) {
        const msg = errorMessage(err)
        logFrontend('error', `[blob-viewer] drop failed: ${msg}`)
        showErrorToast('Failed to read dropped file', msg)
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

  // Tab roll-over with arrow keys.
  const handleTabKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const delta = e.key === 'ArrowRight' ? 1 : -1
      const next = (index + delta + TABS.length) % TABS.length
      setActiveTab(TABS[next].id)
    }
  }, [])

  if (!isOpen) return null

  const sizeLabel =
    working?.kind === 'bytes'
      ? `${working.bytes.length} bytes`
      : working?.kind === 'tooLarge'
        ? `${working.byteLength} bytes`
        : working?.kind === 'null'
          ? 'NULL'
          : ''

  function renderPanelBody() {
    if (loading || !working) {
      return (
        <div className={styles.stateMessage} data-testid="blob-loading">
          Loading…
        </div>
      )
    }
    if (working.kind === 'tooLarge') {
      return (
        <div className={styles.stateMessage} data-testid="blob-too-large-content">
          Content not loaded (exceeds the 10 MB preview limit).
        </div>
      )
    }
    if (working.kind === 'null') {
      return (
        <div className={styles.nullState} data-testid="blob-null-state">
          <ProhibitIcon size={40} />
          <span>Value is NULL</span>
        </div>
      )
    }
    if (working.bytes.length === 0) {
      return (
        <div className={styles.emptyState} data-testid="blob-empty-state">
          <EraserIcon size={40} />
          <span>Empty — 0 bytes</span>
        </div>
      )
    }
    if (activeTab === 'image') {
      return objectUrl ? (
        <div className={styles.imagePanel} data-testid="blob-image">
          <img className={styles.image} src={objectUrl} alt={`${columnLabel} contents`} />
        </div>
      ) : (
        <div className={styles.stateMessage} data-testid="blob-not-image">
          Not a valid image
        </div>
      )
    }
    if (activeTab === 'text') {
      return (
        <pre className={styles.textPanel} data-testid="blob-text">
          {textContent}
        </pre>
      )
    }
    // hex
    return (
      <div className={styles.hexPanel} data-testid="blob-hex">
        {hexRows.map((row) => (
          <div className={styles.hexRow} key={row.offset}>
            <span className={styles.hexOffset}>{row.offset}</span>
            <span className={styles.hexBytes}>
              <span className={styles.hexGroup}>{row.hexBytes.slice(0, 8).join(' ')}</span>
              <span className={styles.hexGroup}>{row.hexBytes.slice(8).join(' ')}</span>
            </span>
            <span className={styles.hexAscii}>{row.ascii}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={handleClose}
      panelWidth="720px"
      panelHeight="560px"
      panelPadding={false}
      testId="blob-viewer-dialog"
      ariaLabel={`BLOB — ${columnLabel}`}
      disableFocusManagement={isPlaywright}
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
            BLOB — <code className={styles.columnName}>{columnLabel}</code>
            {sizeLabel ? <span className={styles.size}> ({sizeLabel})</span> : null}
          </h2>
          <IconButton aria-label="Close" onClick={handleClose} data-testid="blob-close-x">
            <XIcon size={16} weight="bold" />
          </IconButton>
        </div>

        {/* Cap warning banner */}
        {tooLarge && (
          <div className={styles.warningBanner} role="alert" data-testid="blob-cap-warning">
            <WarningCircleIcon size={20} weight="fill" />
            <span>
              This BLOB exceeds the 10 MB preview limit. Save to file to access the full content.
            </span>
          </div>
        )}

        {/* Action bar (edit mode only) */}
        {isEdit && (
          <div className={styles.actionBar} data-testid="blob-action-bar">
            <div className={styles.actionGroup}>
              <Button variant="secondary" onClick={handleLoadFromFile} data-testid="blob-load-file">
                <UploadSimpleIcon size={16} />
                Load from file
              </Button>
              <Button
                variant="secondary"
                onClick={() => setPasteOpen((v) => !v)}
                data-testid="blob-paste-toggle"
              >
                <ClipboardTextIcon size={16} />
                Paste
              </Button>
            </div>
            <div className={styles.actionGroup}>
              <Button variant="danger" onClick={handleSetNull} data-testid="blob-set-null">
                <ProhibitIcon size={16} />
                Set NULL
              </Button>
              <Button variant="danger" onClick={handleClear} data-testid="blob-clear">
                <EraserIcon size={16} />
                Clear
              </Button>
            </div>
          </div>
        )}

        {/* Paste input (revealed) */}
        {isEdit && pasteOpen && (
          <div className={styles.pasteArea} data-testid="blob-paste-area">
            <Textarea
              variant="mono"
              rows={3}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste base64 or hex"
              aria-label="Paste base64 or hex"
              data-testid="blob-paste-input"
            />
            <div className={styles.pasteFooter}>
              <span className={styles.pasteHint}>Accepts base64 or whitespace-tolerant hex.</span>
              <Button onClick={handleApplyPaste} data-testid="blob-paste-apply">
                Load
              </Button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <UnderlineTabBar
          data-testid="blob-tabs"
          suffix={
            <Button
              variant="secondary"
              onClick={handleSaveToFile}
              disabled={!canSave}
              title={
                !canSave && tooLarge ? 'Too large to load — exceeds 10 MB' : 'Save bytes to a file'
              }
              data-testid="blob-save-file"
            >
              <DownloadSimpleIcon size={16} />
              Save to file
            </Button>
          }
        >
          <div role="tablist" aria-label="BLOB views" className={styles.tablist}>
            {TABS.map((tab, index) => {
              const selected = activeTab === tab.id
              const tabClass = selected ? `${styles.tab} ${styles.tabActive}` : styles.tab
              return (
                <button
                  key={tab.id}
                  ref={index === 0 ? firstTabRef : undefined}
                  type="button"
                  className={tabClass}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(e) => handleTabKeyDown(e, index)}
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`blob-panel-${tab.id}`}
                  id={`blob-tab-${tab.id}`}
                  tabIndex={selected ? 0 : -1}
                  data-testid={`blob-tab-${tab.id}`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </UnderlineTabBar>

        {/* Panel */}
        <div
          className={styles.panel}
          role="tabpanel"
          id={`blob-panel-${activeTab}`}
          aria-labelledby={`blob-tab-${activeTab}`}
          data-testid="blob-panel"
        >
          {renderPanelBody()}
        </div>

        {/* Drag hint / footer */}
        {isEdit && <div className={styles.dragHint}>Or drop a file anywhere in this window</div>}

        <div className={styles.footer}>
          {isEdit ? (
            <>
              <Button variant="secondary" onClick={onClose} data-testid="blob-cancel">
                Cancel
              </Button>
              <Button onClick={handleApply} data-testid="blob-apply">
                Apply
              </Button>
            </>
          ) : (
            <Button onClick={onClose} data-testid="blob-close">
              Close
            </Button>
          )}
        </div>

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
