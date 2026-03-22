import { describe, it, expect, vi } from 'vitest'
import {
  getMonacoThemeName,
  registerMonacoThemes,
} from '../../../components/query-editor/monaco-theme'

describe('getMonacoThemeName', () => {
  it('returns dark theme for dark preference', () => {
    expect(getMonacoThemeName('dark', false)).toBe('precision-studio-dark')
  })

  it('returns light theme for light preference', () => {
    expect(getMonacoThemeName('light', false)).toBe('precision-studio-light')
  })

  it('returns dark theme for system dark', () => {
    expect(getMonacoThemeName('system', true)).toBe('precision-studio-dark')
  })

  it('returns light theme for system light', () => {
    expect(getMonacoThemeName('system', false)).toBe('precision-studio-light')
  })

  it('ignores systemIsDark when theme is explicit', () => {
    expect(getMonacoThemeName('light', true)).toBe('precision-studio-light')
    expect(getMonacoThemeName('dark', false)).toBe('precision-studio-dark')
  })
})

describe('registerMonacoThemes', () => {
  it('calls monaco.editor.defineTheme twice (dark and light)', () => {
    const mockMonaco = {
      editor: {
        defineTheme: vi.fn(),
      },
    }
    registerMonacoThemes(mockMonaco as unknown as typeof import('monaco-editor'))
    expect(mockMonaco.editor.defineTheme).toHaveBeenCalledTimes(2)
    expect(mockMonaco.editor.defineTheme).toHaveBeenCalledWith(
      'precision-studio-dark',
      expect.any(Object)
    )
    expect(mockMonaco.editor.defineTheme).toHaveBeenCalledWith(
      'precision-studio-light',
      expect.any(Object)
    )
  })
})
