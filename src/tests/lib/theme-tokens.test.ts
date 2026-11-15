import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyResolvedTheme,
  currentTheme,
  observeThemeChange,
  readPixelToken,
  readThemeColor,
  readToken,
} from '../../lib/theme-tokens'

const rootElement = document.documentElement

beforeEach(() => {
  rootElement.removeAttribute('style')
  rootElement.removeAttribute('class')
})

afterEach(() => {
  rootElement.removeAttribute('style')
  rootElement.removeAttribute('class')
})

describe('currentTheme', () => {
  it('is light without the dark class', () => {
    expect(currentTheme()).toBe('light')
  })

  it('is dark with the dark class', () => {
    rootElement.classList.add('dark')
    expect(currentTheme()).toBe('dark')
  })
})

describe('applyResolvedTheme', () => {
  it('writes the dark class and no data-theme attribute', () => {
    applyResolvedTheme('dark')
    expect(rootElement.classList.contains('dark')).toBe(true)
    expect(rootElement.hasAttribute('data-theme')).toBe(false)
  })

  it('removes the dark class for the light theme and keeps other classes', () => {
    rootElement.classList.add('mica')
    applyResolvedTheme('dark')
    applyResolvedTheme('light')
    expect(rootElement.classList.contains('dark')).toBe(false)
    expect(rootElement.classList.contains('mica')).toBe(true)
    expect(rootElement.hasAttribute('data-theme')).toBe(false)
  })
})

describe('token readers', () => {
  it('reads a token by its full name', () => {
    rootElement.style.setProperty('--font-mono', "  'JetBrains Mono'  ")
    expect(readToken('--font-mono')).toBe("'JetBrains Mono'")
  })

  it('reads a pixel token and falls back when it is missing', () => {
    rootElement.style.setProperty('--spacing-grid-row', '30px')
    expect(readPixelToken('--spacing-grid-row', 28)).toBe(30)
    expect(readPixelToken('--spacing-grid-header', 32)).toBe(32)
  })

  it('reads the colour of the current theme', () => {
    rootElement.style.setProperty('--color-light-primary', '#0067c0')
    rootElement.style.setProperty('--color-dark-primary', '#4cc2ff')
    expect(readThemeColor('primary')).toBe('#0067c0')

    applyResolvedTheme('dark')
    expect(readThemeColor('primary')).toBe('#4cc2ff')
  })
})

describe('observeThemeChange', () => {
  it('notifies when the theme flips and stops after disconnecting', async () => {
    const onChange = vi.fn()
    const stopObserving = observeThemeChange(onChange)

    await act(async () => applyResolvedTheme('dark'))
    expect(onChange).toHaveBeenCalledTimes(1)

    stopObserving()
    await act(async () => applyResolvedTheme('light'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('ignores class changes that leave the theme unchanged', async () => {
    const onChange = vi.fn()
    const stopObserving = observeThemeChange(onChange)

    await act(async () => rootElement.classList.add('mica'))

    expect(onChange).not.toHaveBeenCalled()
    stopObserving()
  })
})
