/**
 * Reads --grid-row-height / --grid-header-height from :root so AG Grid props
 * stay aligned with tokens.css (theme switches update documentElement).
 */

import { useLayoutEffect, useState } from 'react'
import { useThemeStore } from '../stores/theme-store'

const FALLBACK_ROW = 32
const FALLBACK_HEADER = 32

export function useGridAgDimensions(): { rowHeight: number; headerHeight: number } {
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme)
  const [dims, setDims] = useState({ rowHeight: FALLBACK_ROW, headerHeight: FALLBACK_HEADER })

  useLayoutEffect(() => {
    const cs = getComputedStyle(document.documentElement)
    const row = parseFloat(cs.getPropertyValue('--grid-row-height').trim()) || FALLBACK_ROW
    const header = parseFloat(cs.getPropertyValue('--grid-header-height').trim()) || FALLBACK_HEADER
    setDims({ rowHeight: row, headerHeight: header })
  }, [resolvedTheme])

  return dims
}
