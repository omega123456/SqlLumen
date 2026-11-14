import { useEffect, type RefObject } from 'react'

const LAYER_REFRESH_DELAY_MS = 100

interface CompositingLayerRefreshInput {
  hostRef: RefObject<HTMLDivElement | null>
  hasSize: boolean
  size: unknown
}

function scheduleLayerRefresh(host: HTMLDivElement): () => void {
  let frame = 0
  const reset = () => {
    host.style.isolation = ''
    host.style.willChange = ''
  }
  const timer = window.setTimeout(() => {
    host.style.isolation = 'isolate'
    host.style.willChange = 'transform'
    frame = requestAnimationFrame(() => (frame = requestAnimationFrame(reset)))
  }, LAYER_REFRESH_DELAY_MS)
  return () => {
    window.clearTimeout(timer)
    cancelAnimationFrame(frame)
    reset()
  }
}

// WebKit intermittently composites a freshly drawn canvas from a stale low-res layer, blurring the grid.
export function useCompositingLayerRefresh(input: CompositingLayerRefreshInput): void {
  const { hostRef, hasSize, size } = input
  useEffect(() => {
    const host = hostRef.current
    if (!hasSize) return
    if (!host) return
    return scheduleLayerRefresh(host)
  }, [hasSize, hostRef, size])
}
