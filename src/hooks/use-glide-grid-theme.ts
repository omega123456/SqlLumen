import { useEffect, useMemo, useState } from 'react'
import type { Theme } from '@glideapps/glide-data-grid'
import { useGridDimensions } from './use-grid-dimensions'

function readCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function readPxVar(name: string, fallback: number): number {
  return parseFloat(readCssVar(name)) || fallback
}

export function useGlideGridTheme(): Partial<Theme> {
  const { rowHeight, headerHeight } = useGridDimensions()
  const [themeVersion, setThemeVersion] = useState(0)

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeVersion((v) => v + 1))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  return useMemo(() => {
    void themeVersion
    // Glide builds every canvas font as `${style} ${fontFamily}`. The family is the UI font
    // (headers); cell styles prepend the mono stack plus a trailing comma so cell text
    // resolves to mono first: "13px <mono>, <ui>".
    const fontFamily = readCssVar('--font-body')
    const monoFamily = readCssVar('--font-mono')
    const cellFontSize = readCssVar('--type-mono-size') || '13px'
    const bodyFontSize = monoFamily ? `${cellFontSize} ${monoFamily},` : cellFontSize
    const headerFontSize = readCssVar('--type-table-header-size') || '12px'
    const headerWeight = readCssVar('--type-table-header-weight') || '600'
    const horizontalPadding = readPxVar('--grid-cell-padding-x', 10)
    const verticalPadding = readPxVar('--grid-cell-padding-y', 4)
    const gridBorder = readCssVar('--result-grid-border')

    return {
      accentColor: readCssVar('--primary'),
      accentFg: readCssVar('--on-primary'),
      accentLight: readCssVar('--fill-accent-tint'),
      textDark: readCssVar('--on-surface'),
      textMedium: readCssVar('--on-surface-variant'),
      textLight: readCssVar('--td-null-text-color') || readCssVar('--on-surface-variant'),
      textBubble: readCssVar('--on-surface'),
      bgIconHeader: readCssVar('--result-grid-header-bg'),
      fgIconHeader: readCssVar('--on-surface-variant'),
      textHeader: readCssVar('--on-surface-variant'),
      textHeaderSelected: readCssVar('--primary'),
      bgCell: readCssVar('--result-grid-bg'),
      bgCellMedium: readCssVar('--result-grid-row-alt-bg'),
      bgHeader: readCssVar('--result-grid-header-bg'),
      bgHeaderHasFocus: readCssVar('--result-grid-header-bg'),
      bgHeaderHovered: readCssVar('--result-grid-row-hover-bg'),
      bgBubble: readCssVar('--surface-container-high'),
      bgBubbleSelected: readCssVar('--result-grid-row-selected-bg'),
      bgSearchResult: readCssVar('--fk-lookup-target-col-bg'),
      borderColor: gridBorder,
      horizontalBorderColor: gridBorder,
      headerBottomBorderColor: gridBorder,
      drilldownBorder: readCssVar('--outline-variant'),
      linkColor: readCssVar('--primary'),
      cellHorizontalPadding: horizontalPadding,
      cellVerticalPadding: verticalPadding,
      headerFontStyle: `${headerWeight} ${headerFontSize}`,
      headerIconSize: Math.max(12, Math.min(18, headerHeight - 14)),
      baseFontStyle: bodyFontSize,
      markerFontStyle: bodyFontSize,
      fontFamily,
      editorFontSize: cellFontSize,
      lineHeight: rowHeight,
      roundingRadius: readPxVar('--radius-control', 4),
    }
  }, [headerHeight, rowHeight, themeVersion])
}
