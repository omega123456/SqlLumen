import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useGlideGridTheme } from '../../hooks/use-glide-grid-theme'

function setVars(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values))
    document.documentElement.style.setProperty(key, value)
}

describe('useGlideGridTheme', () => {
  it('maps light tokens', () => {
    document.documentElement.dataset.theme = 'light'
    setVars({
      '--primary': '#0066cc',
      '--on-primary': '#fff',
      '--primary-rgb': '0, 102, 204',
      '--on-surface': '#111',
      '--on-surface-variant': '#555',
      '--td-null-text-color': '#999',
      '--result-grid-bg': '#fff',
      '--result-grid-row-alt-bg': '#f7f7f7',
      '--result-grid-header-bg': '#eee',
      '--result-grid-row-hover-bg': '#ddd',
      '--result-grid-row-selected-bg': '#cde',
      '--surface-container-high': '#eee',
      '--fk-lookup-target-col-bg': '#eef',
      '--outline-variant': '#ccc',
      '--outline-variant-rgb': '204, 204, 204',
      '--font-mono': 'monospace',
      '--type-size-md': '13px',
      '--type-table-header-size': '10px',
      '--type-table-header-weight': '700',
      '--grid-cell-padding-x': '24px',
      '--grid-cell-padding-y': '10px',
      '--grid-row-height': '36px',
      '--grid-header-height': '36px',
    })
    const { result } = renderHook(() => useGlideGridTheme())
    expect(result.current.accentColor).toBe('#0066cc')
    expect(result.current.bgCell).toBe('#fff')
    expect(result.current.lineHeight).toBe(36)
    expect(result.current.cellHorizontalPadding).toBe(24)
  })

  it('re-reads when data-theme changes', async () => {
    document.documentElement.dataset.theme = 'light'
    setVars({
      '--primary': '#0066cc',
      '--on-primary': '#fff',
      '--primary-rgb': '0, 102, 204',
      '--on-surface': '#111',
      '--on-surface-variant': '#555',
      '--td-null-text-color': '#999',
      '--result-grid-bg': '#fff',
      '--result-grid-row-alt-bg': '#f7f7f7',
      '--result-grid-header-bg': '#eee',
      '--result-grid-row-hover-bg': '#ddd',
      '--result-grid-row-selected-bg': '#cde',
      '--surface-container-high': '#eee',
      '--fk-lookup-target-col-bg': '#eef',
      '--outline-variant': '#ccc',
      '--outline-variant-rgb': '204, 204, 204',
      '--font-mono': 'monospace',
      '--type-size-md': '13px',
      '--type-table-header-size': '10px',
      '--type-table-header-weight': '700',
      '--grid-cell-padding-x': '24px',
      '--grid-cell-padding-y': '10px',
      '--grid-row-height': '36px',
      '--grid-header-height': '36px',
    })
    const { result } = renderHook(() => useGlideGridTheme())
    setVars({ '--primary': '#7bd0ff', '--result-grid-bg': '#0b1326', '--grid-row-height': '32px' })
    document.documentElement.dataset.theme = 'dark'
    await waitFor(() => expect(result.current.accentColor).toBe('#7bd0ff'))
    expect(result.current.bgCell).toBe('#0b1326')
  })
})
