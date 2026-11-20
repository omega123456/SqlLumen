import { describe, it, expect, vi } from 'vitest'
import { getMonacoThemeName, registerMonacoThemes } from '../../lib/monaco-theme'

describe('getMonacoThemeName', () => {
  it('returns dark theme for dark preference', () => {
    expect(getMonacoThemeName('dark', false)).toBe('precision-studio-dark')
  })

  it('returns light theme for light preference', () => {
    expect(getMonacoThemeName('light', false)).toBe('precision-studio-light')
  })
})

describe('registerMonacoThemes', () => {
  it('defines themes only once per Monaco instance', () => {
    const mockMonaco = { editor: { defineTheme: vi.fn() } }
    const instance = mockMonaco as unknown as typeof import('monaco-editor')
    registerMonacoThemes(instance)
    registerMonacoThemes(instance)
    expect(mockMonaco.editor.defineTheme).toHaveBeenCalledTimes(2)
  })
})
