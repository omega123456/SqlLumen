import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyResolvedTheme,
  currentTheme,
  observeThemeChange,
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
})

describe('applyResolvedTheme', () => {
  it('writes the dark class and no data-theme attribute', () => {
    applyResolvedTheme('dark')
    expect(rootElement.classList.contains('dark')).toBe(true)
    expect(rootElement.hasAttribute('data-theme')).toBe(false)
  })
})

describe('token readers', () => {
  it('reads a token by its full name', () => {
    rootElement.style.setProperty('--font-mono', "  'JetBrains Mono'  ")
    expect(readToken('--font-mono')).toBe("'JetBrains Mono'")
  })
})

describe('observeThemeChange', () => {
  it('ignores class changes that leave the theme unchanged', async () => {
    const onChange = vi.fn()
    const stopObserving = observeThemeChange(onChange)

    await act(async () => rootElement.classList.add('mica'))

    expect(onChange).not.toHaveBeenCalled()
    stopObserving()
  })
})
