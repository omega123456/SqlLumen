import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useGridDimensions } from '../../hooks/use-grid-dimensions'
import { useThemeStore } from '../../stores/theme-store'

const ROW_HEIGHT_TOKEN = '--spacing-grid-row'
const HEADER_HEIGHT_TOKEN = '--spacing-grid-header'

function setVar(name: string, value: string) {
  document.documentElement.style.setProperty(name, value)
}

afterEach(() => {
  document.documentElement.style.removeProperty(ROW_HEIGHT_TOKEN)
  document.documentElement.style.removeProperty(HEADER_HEIGHT_TOKEN)
  act(() => {
    useThemeStore.setState({ resolvedTheme: 'light' })
  })
})

describe('useGridDimensions', () => {
  it('falls back to 28px rows and a 32px header when tokens are missing', () => {
    const { result } = renderHook(() => useGridDimensions())
    expect(result.current).toEqual({ rowHeight: 28, headerHeight: 32 })
  })

  it('re-reads the tokens when the resolved theme changes', () => {
    setVar(ROW_HEIGHT_TOKEN, '28px')
    const { result } = renderHook(() => useGridDimensions())
    expect(result.current.rowHeight).toBe(28)

    setVar(ROW_HEIGHT_TOKEN, '30px')
    act(() => {
      useThemeStore.setState({ resolvedTheme: 'dark' })
    })
    expect(result.current.rowHeight).toBe(30)
  })
})
