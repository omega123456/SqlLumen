import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useGridDimensions } from '../../hooks/use-grid-dimensions'
import { useThemeStore } from '../../stores/theme-store'

function setVar(name: string, value: string) {
  document.documentElement.style.setProperty(name, value)
}

afterEach(() => {
  document.documentElement.style.removeProperty('--grid-row-height')
  document.documentElement.style.removeProperty('--grid-header-height')
  act(() => {
    useThemeStore.setState({ resolvedTheme: 'light' })
  })
})

describe('useGridDimensions', () => {
  it('falls back to 28px rows and a 32px header when tokens are missing', () => {
    const { result } = renderHook(() => useGridDimensions())
    expect(result.current).toEqual({ rowHeight: 28, headerHeight: 32 })
  })

  it('reads the row and header heights from tokens', () => {
    setVar('--grid-row-height', '28px')
    setVar('--grid-header-height', '32px')
    const { result } = renderHook(() => useGridDimensions())
    expect(result.current).toEqual({ rowHeight: 28, headerHeight: 32 })
  })

  it('re-reads the tokens when the resolved theme changes', () => {
    setVar('--grid-row-height', '28px')
    const { result } = renderHook(() => useGridDimensions())
    expect(result.current.rowHeight).toBe(28)

    setVar('--grid-row-height', '30px')
    act(() => {
      useThemeStore.setState({ resolvedTheme: 'dark' })
    })
    expect(result.current.rowHeight).toBe(30)
  })
})
