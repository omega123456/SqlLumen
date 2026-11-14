import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import {
  RAIL_TOOLTIP_DELAY_MS,
  centeredOffset,
  type RailEntry,
  type RailKey,
  type RailTooltipState,
} from './group-rail-model'

const MARKER_HEIGHT = 24
const TOOLTIP_HEIGHT = 28

type RailItemRefs = RefObject<Map<RailKey, HTMLButtonElement>>

export function useRailMarker(
  itemRefs: RailItemRefs,
  selectedKey: RailKey | null,
  entries: RailEntry[]
) {
  const markerRef = useRef<HTMLDivElement | null>(null)
  const markerPlacedRef = useRef(false)
  useLayoutEffect(() => {
    const marker = markerRef.current
    const item = selectedKey ? itemRefs.current.get(selectedKey) : undefined
    const hasNoMarkerTarget = !marker || !item
    if (hasNoMarkerTarget) {
      markerPlacedRef.current = false
      return
    }
    marker.dataset.animate = markerPlacedRef.current ? 'true' : 'false'
    marker.style.transform = `translateY(${centeredOffset(item, MARKER_HEIGHT)}px)`
    markerPlacedRef.current = true
  }, [selectedKey, entries, itemRefs])
  return markerRef
}

export function useRailTooltip(itemRefs: RailItemRefs) {
  const [tooltip, setTooltip] = useState<RailTooltipState | null>(null)
  const tooltipTimerRef = useRef<number | null>(null)

  const clearTooltipTimer = () => {
    if (tooltipTimerRef.current === null) return
    window.clearTimeout(tooltipTimerRef.current)
    tooltipTimerRef.current = null
  }
  const hideTooltip = () => {
    clearTooltipTimer()
    setTooltip(null)
  }
  const scheduleTooltip = (key: RailKey) => {
    clearTooltipTimer()
    tooltipTimerRef.current = window.setTimeout(() => {
      tooltipTimerRef.current = null
      const item = itemRefs.current.get(key)
      if (!item) return
      setTooltip({ key: key, top: centeredOffset(item, TOOLTIP_HEIGHT) })
    }, RAIL_TOOLTIP_DELAY_MS)
  }
  useEffect(() => clearTooltipTimer, [])

  return { tooltip, hideTooltip, scheduleTooltip }
}

export type RailTooltipControls = ReturnType<typeof useRailTooltip>
