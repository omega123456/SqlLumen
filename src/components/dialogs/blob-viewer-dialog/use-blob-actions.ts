import { useCallback, type RefObject } from 'react'
import { base64ToBytes, bytesToBase64, detectBlobExtension } from '../../../lib/blob-utils'
import { readFileBytes, writeFileBytes } from '../../../lib/table-data-commands'
import { logFrontend } from '../../../lib/app-log-commands'
import { toErrorMessage } from '../../../lib/error-message'
import { showErrorToast } from '../../../stores/toast-store'
import type { BlobEnvelope } from '../../../types/schema'
import { FILE_LOAD_CAP, envelopeForWorkingValue } from './blob-working-value'
import type { BlobSessionState } from './use-blob-viewer-session'

interface BlobActionsInput {
  session: BlobSessionState
  columnLabel: string
  onApply: ((envelope: BlobEnvelope) => void) | undefined
  onClose: () => void
}

interface BlobDragInput {
  session: BlobSessionState
  dragDepth: RefObject<number>
  isEdit: boolean
  applyBytes: (bytes: Uint8Array) => void
  onClose: () => void
}

const FILE_EXTENSION_DOT = /^\./

function reportBlobFailure(logLabel: string, toastTitle: string, error: unknown): void {
  const message = toErrorMessage(error)
  logFrontend('error', `[blob-viewer] ${logLabel}: ${message}`)
  showErrorToast(toastTitle, message)
}

async function pickFileBytes(): Promise<Uint8Array | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({ multiple: false, directory: false })
  if (typeof selected !== 'string') return null
  return base64ToBytes(await readFileBytes(selected))
}

async function saveBytesToFile(bytes: Uint8Array, columnLabel: string): Promise<void> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const extension = detectBlobExtension(bytes)
  const selected = await save({
    defaultPath: `${columnLabel || 'blob'}${extension}`,
    filters: [{ name: 'Binary', extensions: [extension.replace(FILE_EXTENSION_DOT, '')] }],
  })
  if (typeof selected !== 'string') return
  await writeFileBytes(selected, bytesToBase64(bytes))
}

export function useBlobActions({ session, columnLabel, onApply, onClose }: BlobActionsInput) {
  const { working, setWorking, setPasteOpen } = session

  const applyBytes = useCallback(
    (bytes: Uint8Array) => {
      setWorking({ kind: 'bytes', bytes: bytes })
      setPasteOpen(false)
    },
    [setPasteOpen, setWorking]
  )

  const handleLoadFromFile = useCallback(async () => {
    try {
      const bytes = await pickFileBytes()
      if (!bytes) return
      if (bytes.length > FILE_LOAD_CAP) {
        showErrorToast('File too large', 'The selected file exceeds the 10 MB limit.')
        return
      }
      applyBytes(bytes)
    } catch (error) {
      reportBlobFailure('load from file failed', 'Failed to load file', error)
    }
  }, [applyBytes])

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
    try {
      await saveBytesToFile(working.bytes, columnLabel)
    } catch (error) {
      reportBlobFailure('save to file failed', 'Failed to save file', error)
    }
  }, [working, columnLabel])

  return {
    applyBytes: applyBytes,
    handleLoadFromFile: handleLoadFromFile,
    handleSetNull: () => {
      setWorking({ kind: 'null' })
      setPasteOpen(false)
    },
    handleClear: () => applyBytes(new Uint8Array(0)),
    handleApply: handleApply,
    handleSaveToFile: handleSaveToFile,
  }
}

async function readDroppedBytes(event: React.DragEvent): Promise<Uint8Array | null> {
  const file = event.dataTransfer.files?.[0]
  if (!file) return null
  return new Uint8Array(await file.arrayBuffer())
}

function resetDragDepth(dragDepth: RefObject<number>): void {
  dragDepth.current = 0
}

export function useBlobDragAndDrop(input: BlobDragInput) {
  const { session, dragDepth, isEdit, applyBytes, onClose } = input
  const { dragOver, setDragOver } = session

  const handleDrop = async (event: React.DragEvent) => {
    if (!isEdit) return
    event.preventDefault()
    resetDragDepth(dragDepth)
    setDragOver(false)
    try {
      const bytes = await readDroppedBytes(event)
      if (!bytes) return
      if (bytes.length > FILE_LOAD_CAP) {
        showErrorToast('File too large', 'The dropped file exceeds the 10 MB limit.')
        return
      }
      applyBytes(bytes)
    } catch (error) {
      reportBlobFailure('drop failed', 'Failed to read dropped file', error)
    }
  }

  return {
    handleDragEnter: (event: React.DragEvent) => {
      if (!isEdit) return
      event.preventDefault()
      dragDepth.current += 1
      setDragOver(true)
    },
    handleDragOver: (event: React.DragEvent) => {
      if (!isEdit) return
      event.preventDefault()
    },
    handleDragLeave: (event: React.DragEvent) => {
      if (!isEdit) return
      event.preventDefault()
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragOver(false)
    },
    handleDrop: handleDrop,
    handleClose: () => {
      if (!dragOver) {
        onClose()
        return
      }
      resetDragDepth(dragDepth)
      setDragOver(false)
    },
  }
}
