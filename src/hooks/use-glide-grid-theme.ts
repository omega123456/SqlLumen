import { useEffect, useMemo, useState } from 'react'
import type { Theme } from '@glideapps/glide-data-grid'
import { observeThemeChange, readPixelToken, readThemeColor, readToken } from '../lib/theme-tokens'
import { useGridDimensions } from './use-grid-dimensions'

const FALLBACK_CELL_PADDING_X_PX = 10
const FALLBACK_CELL_PADDING_Y_PX = 4
const FALLBACK_CONTROL_RADIUS_PX = 4
const FALLBACK_CELL_FONT_SIZE = '13px'
const FALLBACK_HEADER_FONT_SIZE = '12px'
const FALLBACK_HEADER_FONT_WEIGHT = '600'
const MIN_HEADER_ICON_SIZE_PX = 12
const MAX_HEADER_ICON_SIZE_PX = 18
const HEADER_ICON_VERTICAL_INSET_PX = 14
const TRANSPARENT_COLOR = 'transparent'

function useThemeVersion(): number {
  const [themeVersion, setThemeVersion] = useState(0)

  useEffect(() => {
    return observeThemeChange(() => setThemeVersion((version) => version + 1))
  }, [])

  return themeVersion
}

export function useGlideSkeletonColor(): string {
  const themeVersion = useThemeVersion()
  return useMemo(() => {
    void themeVersion
    return readThemeColor('fill-neutral-selected')
  }, [themeVersion])
}

function glideColorTheme(): Partial<Theme> {
  const gridBorder = readThemeColor('stroke-divider')
  const headerBackground = readThemeColor('surface-container')

  return {
    accentColor: readThemeColor('primary'),
    accentFg: readThemeColor('on-primary'),
    accentLight: readThemeColor('fill-accent-tint'),
    textDark: readThemeColor('on-surface'),
    textMedium: readThemeColor('on-surface-variant'),
    textLight: readThemeColor('outline'),
    textBubble: readThemeColor('on-surface'),
    bgIconHeader: headerBackground,
    fgIconHeader: readThemeColor('on-surface-variant'),
    textHeader: readThemeColor('on-surface-variant'),
    textHeaderSelected: readThemeColor('primary'),
    bgCell: readThemeColor('surface-container-lowest'),
    bgCellMedium: TRANSPARENT_COLOR,
    bgHeader: headerBackground,
    bgHeaderHasFocus: headerBackground,
    bgHeaderHovered: readThemeColor('fill-subtle-hover'),
    bgBubble: readThemeColor('surface-container-high'),
    bgBubbleSelected: readThemeColor('fill-accent-tint'),
    bgSearchResult: readThemeColor('fill-accent-tint'),
    borderColor: gridBorder,
    horizontalBorderColor: gridBorder,
    headerBottomBorderColor: gridBorder,
    drilldownBorder: readThemeColor('outline-variant'),
    linkColor: readThemeColor('primary'),
  }
}

function glideTypographyTheme(): Partial<Theme> {
  const monoFamily = readToken('--font-mono')
  const cellFontSize = readToken('--text-size-mono') || FALLBACK_CELL_FONT_SIZE
  const bodyFontSize = monoFamily ? `${cellFontSize} ${monoFamily},` : cellFontSize
  const headerFontSize = readToken('--text-size-caption') || FALLBACK_HEADER_FONT_SIZE
  const headerWeight = readToken('--font-weight-semibold') || FALLBACK_HEADER_FONT_WEIGHT

  return {
    headerFontStyle: `${headerWeight} ${headerFontSize}`,
    baseFontStyle: bodyFontSize,
    markerFontStyle: bodyFontSize,
    fontFamily: readToken('--font-body'),
    editorFontSize: cellFontSize,
  }
}

function glideMetricsTheme(headerHeight: number, rowHeight: number): Partial<Theme> {
  const headerIconSize = headerHeight - HEADER_ICON_VERTICAL_INSET_PX

  return {
    cellHorizontalPadding: readPixelToken('--spacing-grid-cell-x', FALLBACK_CELL_PADDING_X_PX),
    cellVerticalPadding: readPixelToken('--spacing-grid-cell-y', FALLBACK_CELL_PADDING_Y_PX),
    headerIconSize: Math.max(
      MIN_HEADER_ICON_SIZE_PX,
      Math.min(MAX_HEADER_ICON_SIZE_PX, headerIconSize)
    ),
    lineHeight: rowHeight,
    roundingRadius: readPixelToken('--radius-control', FALLBACK_CONTROL_RADIUS_PX),
  }
}

export function useGlideGridTheme(): Partial<Theme> {
  const { rowHeight, headerHeight } = useGridDimensions()
  const themeVersion = useThemeVersion()

  return useMemo(() => {
    void themeVersion
    return {
      ...glideColorTheme(),
      ...glideTypographyTheme(),
      ...glideMetricsTheme(headerHeight, rowHeight),
    }
  }, [headerHeight, rowHeight, themeVersion])
}
