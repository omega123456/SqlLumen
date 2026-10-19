import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useGlideGridTheme } from '../../hooks/use-glide-grid-theme'

const TOKEN_NAMES = [
  '--primary',
  '--on-primary',
  '--fill-accent-tint',
  '--on-surface',
  '--on-surface-variant',
  '--td-null-text-color',
  '--result-grid-bg',
  '--result-grid-row-alt-bg',
  '--result-grid-header-bg',
  '--result-grid-row-hover-bg',
  '--result-grid-row-selected-bg',
  '--result-grid-border',
  '--surface-container-high',
  '--fk-lookup-target-col-bg',
  '--outline-variant',
  '--font-body',
  '--font-mono',
  '--type-mono-size',
  '--type-table-header-size',
  '--type-table-header-weight',
  '--grid-cell-padding-x',
  '--grid-cell-padding-y',
  '--grid-row-height',
  '--grid-header-height',
  '--radius-control',
]

function setVars(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values))
    document.documentElement.style.setProperty(key, value)
}

const LIGHT_TOKENS: Record<string, string> = {
  '--primary': '#0067c0',
  '--on-primary': '#ffffff',
  '--fill-accent-tint': 'rgba(0, 103, 192, 0.11)',
  '--on-surface': '#1b1b1b',
  '--on-surface-variant': '#5d5d5d',
  '--td-null-text-color': '#6e6e6e',
  '--result-grid-bg': '#ffffff',
  '--result-grid-row-alt-bg': 'transparent',
  '--result-grid-header-bg': '#f9f9f9',
  '--result-grid-row-hover-bg': 'rgba(0, 0, 0, 0.04)',
  '--result-grid-row-selected-bg': 'rgba(0, 103, 192, 0.11)',
  '--result-grid-border': 'rgba(0, 0, 0, 0.08)',
  '--surface-container-high': '#ffffff',
  '--fk-lookup-target-col-bg': 'rgba(0, 103, 192, 0.11)',
  '--outline-variant': 'rgba(0, 0, 0, 0.07)',
  '--font-body': "'Selawik', sans-serif",
  '--font-mono': "'JetBrains Mono', monospace",
  '--type-mono-size': '13px',
  '--type-table-header-size': '12px',
  '--type-table-header-weight': '600',
  '--grid-cell-padding-x': '10px',
  '--grid-cell-padding-y': '4px',
  '--grid-row-height': '28px',
  '--grid-header-height': '32px',
  '--radius-control': '4px',
}

afterEach(() => {
  for (const name of TOKEN_NAMES) document.documentElement.style.removeProperty(name)
})

describe('useGlideGridTheme', () => {
  it('maps light tokens', () => {
    document.documentElement.dataset.theme = 'light'
    setVars(LIGHT_TOKENS)
    const { result } = renderHook(() => useGlideGridTheme())
    expect(result.current.accentColor).toBe('#0067c0')
    expect(result.current.accentLight).toBe('rgba(0, 103, 192, 0.11)')
    expect(result.current.bgCell).toBe('#ffffff')
    expect(result.current.bgCellMedium).toBe('transparent')
    expect(result.current.lineHeight).toBe(28)
    expect(result.current.cellHorizontalPadding).toBe(10)
    expect(result.current.cellVerticalPadding).toBe(4)
  })

  it('uses the control radius for rounded selection rings', () => {
    setVars({ ...LIGHT_TOKENS, '--radius-control': '6px' })
    const { result } = renderHook(() => useGlideGridTheme())
    expect(result.current.roundingRadius).toBe(6)
  })

  it('falls back to a 4px radius and Fluent grid metrics when tokens are missing', () => {
    const { result } = renderHook(() => useGlideGridTheme())
    expect(result.current.roundingRadius).toBe(4)
    expect(result.current.cellHorizontalPadding).toBe(10)
    expect(result.current.cellVerticalPadding).toBe(4)
    expect(result.current.headerFontStyle).toBe('600 12px')
    expect(result.current.baseFontStyle).toBe('13px')
    expect(result.current.lineHeight).toBe(28)
  })

  it('draws all grid lines with the divider token', () => {
    setVars(LIGHT_TOKENS)
    const { result } = renderHook(() => useGlideGridTheme())
    expect(result.current.borderColor).toBe('rgba(0, 0, 0, 0.08)')
    expect(result.current.horizontalBorderColor).toBe('rgba(0, 0, 0, 0.08)')
    expect(result.current.headerBottomBorderColor).toBe('rgba(0, 0, 0, 0.08)')
  })

  it('renders headers in the UI font and cell values in mono first', () => {
    setVars(LIGHT_TOKENS)
    const { result } = renderHook(() => useGlideGridTheme())
    expect(result.current.fontFamily).toBe("'Selawik', sans-serif")
    expect(result.current.headerFontStyle).toBe('600 12px')
    // Glide appends fontFamily, so the trailing comma yields "13px <mono>, <ui>"
    expect(result.current.baseFontStyle).toBe("13px 'JetBrains Mono', monospace,")
    expect(`${result.current.baseFontStyle} ${result.current.fontFamily}`).toBe(
      "13px 'JetBrains Mono', monospace, 'Selawik', sans-serif"
    )
    expect(result.current.editorFontSize).toBe('13px')
  })

  it('re-reads when data-theme changes', async () => {
    document.documentElement.dataset.theme = 'light'
    setVars(LIGHT_TOKENS)
    const { result } = renderHook(() => useGlideGridTheme())
    setVars({ '--primary': '#4cc2ff', '--result-grid-bg': '#1c1c1c' })
    document.documentElement.dataset.theme = 'dark'
    await waitFor(() => expect(result.current.accentColor).toBe('#4cc2ff'))
    expect(result.current.bgCell).toBe('#1c1c1c')
  })
})
