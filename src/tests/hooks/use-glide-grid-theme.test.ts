import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useGlideGridTheme, useGlideSkeletonColor } from '../../hooks/use-glide-grid-theme'
import { applyResolvedTheme } from '../../lib/theme-tokens'

const LIGHT_TOKENS: Record<string, string> = {
  '--color-light-primary': '#0067c0',
  '--color-light-on-primary': '#ffffff',
  '--color-light-fill-accent-tint': 'rgba(0, 103, 192, 0.11)',
  '--color-light-on-surface': '#1b1b1b',
  '--color-light-on-surface-variant': '#5d5d5d',
  '--color-light-outline': '#6e6e6e',
  '--color-light-surface-container-lowest': '#ffffff',
  '--color-light-surface-container': '#f9f9f9',
  '--color-light-fill-subtle-hover': 'rgba(0, 0, 0, 0.04)',
  '--color-light-stroke-divider': 'rgba(0, 0, 0, 0.08)',
  '--color-light-surface-container-high': '#ffffff',
  '--color-light-outline-variant': 'rgba(0, 0, 0, 0.07)',
  '--color-light-fill-neutral-selected': 'rgba(0, 0, 0, 0.06)',
  '--font-body': "'Selawik', sans-serif",
  '--font-mono': "'JetBrains Mono', monospace",
  '--text-size-mono': '13px',
  '--text-size-caption': '12px',
  '--font-weight-semibold': '600',
  '--spacing-grid-cell-x': '10px',
  '--spacing-grid-cell-y': '4px',
  '--spacing-grid-row': '28px',
  '--spacing-grid-header': '32px',
  '--radius-control': '4px',
}

const DARK_TOKENS: Record<string, string> = {
  '--color-dark-primary': '#4cc2ff',
  '--color-dark-surface-container-lowest': '#1c1c1c',
  '--color-dark-fill-neutral-selected': 'rgba(255, 255, 255, 0.07)',
}

function setVars(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values))
    document.documentElement.style.setProperty(key, value)
}

beforeEach(() => {
  document.documentElement.removeAttribute('style')
  applyResolvedTheme('light')
})

describe('useGlideGridTheme', () => {
  it('maps light tokens', () => {
    setVars(LIGHT_TOKENS)
    const { result } = renderHook(() => useGlideGridTheme())
    expect(result.current.accentColor).toBe('#0067c0')
    expect(result.current.accentLight).toBe('rgba(0, 103, 192, 0.11)')
    expect(result.current.textLight).toBe('#6e6e6e')
    expect(result.current.bgCell).toBe('#ffffff')
    expect(result.current.bgHeader).toBe('#f9f9f9')
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
    expect(result.current.baseFontStyle).toBe("13px 'JetBrains Mono', monospace,")
    expect(`${result.current.baseFontStyle} ${result.current.fontFamily}`).toBe(
      "13px 'JetBrains Mono', monospace, 'Selawik', sans-serif"
    )
    expect(result.current.editorFontSize).toBe('13px')
  })

  it('re-reads the dark colour tokens when the dark class is applied', async () => {
    setVars({ ...LIGHT_TOKENS, ...DARK_TOKENS })
    const { result } = renderHook(() => useGlideGridTheme())
    expect(result.current.accentColor).toBe('#0067c0')

    await act(async () => applyResolvedTheme('dark'))

    await waitFor(() => expect(result.current.accentColor).toBe('#4cc2ff'))
    expect(result.current.bgCell).toBe('#1c1c1c')
  })
})

describe('useGlideSkeletonColor', () => {
  it('reads the neutral selection token and re-reads on theme change', async () => {
    setVars({ ...LIGHT_TOKENS, ...DARK_TOKENS })
    const { result } = renderHook(() => useGlideSkeletonColor())
    expect(result.current).toBe('rgba(0, 0, 0, 0.06)')

    await act(async () => applyResolvedTheme('dark'))

    await waitFor(() => expect(result.current).toBe('rgba(255, 255, 255, 0.07)'))
  })
})
