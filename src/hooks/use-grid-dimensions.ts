import { readPixelToken } from '../lib/theme-tokens'
import { useThemeStore } from '../stores/theme-store'

const FALLBACK_ROW = 28
const FALLBACK_HEADER = 32

export function useGridDimensions(): { rowHeight: number; headerHeight: number } {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  void resolvedTheme
  return {
    rowHeight: readPixelToken('--spacing-grid-row', FALLBACK_ROW),
    headerHeight: readPixelToken('--spacing-grid-header', FALLBACK_HEADER),
  }
}
