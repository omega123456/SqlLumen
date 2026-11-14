import { useThemeStore } from '../stores/theme-store'

const FALLBACK_ROW = 28
const FALLBACK_HEADER = 32

export function useGridDimensions(): { rowHeight: number; headerHeight: number } {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  void resolvedTheme
  const cs = getComputedStyle(document.documentElement)
  const row = parseFloat(cs.getPropertyValue('--grid-row-height').trim()) || FALLBACK_ROW
  const header = parseFloat(cs.getPropertyValue('--grid-header-height').trim()) || FALLBACK_HEADER
  return { rowHeight: row, headerHeight: header }
}
