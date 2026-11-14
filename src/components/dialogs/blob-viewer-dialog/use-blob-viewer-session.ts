import { useEffect, useMemo, useRef, useState } from 'react'
import {
  blobTypeLabel,
  decodeUtf8BestEffort,
  formatHexDump,
  readImageDimensions,
  sniffImageMime,
} from '../../../lib/blob-utils'
import { toErrorMessage } from '../../../lib/error-message'
import { isPlaywrightBuild } from '../../../lib/tauri-env'
import { showErrorToast } from '../../../stores/toast-store'
import type { BlobValueResponse } from '../../../types/schema'
import {
  EMPTY_WORKING_VALUE,
  decodeInitialBase64,
  hasBytes,
  workingBytesOf,
  workingFromResponse,
  type BlobTab,
  type WorkingValue,
} from './blob-working-value'

export interface BlobSource {
  isOpen: boolean
  loader?: () => Promise<BlobValueResponse>
  initialBase64?: string | null
}

function useBlobSessionState() {
  const [working, setWorking] = useState<WorkingValue | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<BlobTab>('image')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  return {
    working,
    setWorking,
    loading,
    setLoading,
    activeTab,
    setActiveTab,
    pasteOpen,
    setPasteOpen,
    dragOver,
    setDragOver,
  }
}

export type BlobSessionState = ReturnType<typeof useBlobSessionState>

function useFocusFirstTabOnOpen(isOpen: boolean) {
  const firstTabRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!isOpen) return
    if (isPlaywrightBuild()) return
    const id = requestAnimationFrame(() => {
      firstTabRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [isOpen])
  return firstTabRef
}

export function useBlobViewerSession({ isOpen, loader, initialBase64 }: BlobSource) {
  const state = useBlobSessionState()
  const { setWorking, setLoading, setActiveTab, setPasteOpen, setDragOver } = state
  const dragDepth = useRef(0)
  const firstTabRef = useFocusFirstTabOnOpen(isOpen)

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
  }, [
    isOpen,
    loader,
    initialBase64,
    setActiveTab,
    setDragOver,
    setLoading,
    setPasteOpen,
    setWorking,
  ])

  return { state, dragDepth, firstTabRef }
}

function createImageObjectUrl(
  workingBytes: Uint8Array | null,
  imageMime: string | null
): string | null {
  if (!workingBytes) return null
  if (!imageMime) return null
  return URL.createObjectURL(new Blob([workingBytes.slice().buffer], { type: imageMime }))
}

function useBlobObjectUrl(workingBytes: Uint8Array | null, imageMime: string | null) {
  const objectUrl = useMemo(
    () => createImageObjectUrl(workingBytes, imageMime),
    [workingBytes, imageMime]
  )
  useEffect(() => {
    if (!objectUrl) return
    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [objectUrl])
  return objectUrl
}

export function useBlobContent(working: WorkingValue | null) {
  const workingBytes = workingBytesOf(working)
  const imageMime = useMemo(
    () => (hasBytes(workingBytes) ? sniffImageMime(workingBytes) : null),
    [workingBytes]
  )
  const objectUrl = useBlobObjectUrl(workingBytes, imageMime)
  const textContent = useMemo(
    () => (workingBytes ? decodeUtf8BestEffort(workingBytes) : ''),
    [workingBytes]
  )
  const hexRows = useMemo(() => (workingBytes ? formatHexDump(workingBytes) : []), [workingBytes])
  const typeLabel = useMemo(
    () => (workingBytes ? blobTypeLabel(workingBytes) : null),
    [workingBytes]
  )
  const dimensions = useMemo(
    () => (hasBytes(workingBytes) ? readImageDimensions(workingBytes) : null),
    [workingBytes]
  )
  return { objectUrl, textContent, hexRows, typeLabel, dimensions }
}
