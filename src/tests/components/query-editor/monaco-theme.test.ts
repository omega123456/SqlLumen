import { describe, it, expect, vi } from 'vitest'
import { MONACO_THEMES, getMonacoThemeName, registerMonacoThemes } from '../../../lib/monaco-theme'
import { readThemeTokens } from '../../helpers/tailwind-theme'

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

  it('defines themes only once per Monaco instance', () => {
    const mockMonaco = { editor: { defineTheme: vi.fn() } }
    const instance = mockMonaco as unknown as typeof import('monaco-editor')
    registerMonacoThemes(instance)
    registerMonacoThemes(instance)
    expect(mockMonaco.editor.defineTheme).toHaveBeenCalledTimes(2)
  })
})

// Values from the proposal's prototype (`--sx-*`, well, accent and accent tint).
const PROTOTYPE = {
  'precision-studio-dark': {
    well: '#1c1c1c',
    text: 'd4d4d4',
    keyword: '569cd6',
    string: 'ce9178',
    number: 'b5cea8',
    quoted: '9cdcfe',
    lineNumber: '#6e7681',
    currentLine: '#ffffff0a',
    accent: '#4cc2ff',
    selection: '#4cc2ff26',
  },
  'precision-studio-light': {
    well: '#ffffff',
    text: '1b1b1b',
    keyword: '0000ff',
    string: 'a31515',
    number: '098658',
    quoted: '001080',
    lineNumber: '#8c8c8c',
    currentLine: '#00000009',
    accent: '#0067c0',
    selection: '#0067c01c',
  },
} as const

function tokenColor(name: keyof typeof PROTOTYPE, token: string): string | undefined {
  return MONACO_THEMES[name].rules.find((rule) => rule.token === token)?.foreground
}

describe('Monaco themes match the Fluent proposal', () => {
  for (const [name, p] of Object.entries(PROTOTYPE) as [
    keyof typeof PROTOTYPE,
    (typeof PROTOTYPE)[keyof typeof PROTOTYPE],
  ][]) {
    it(`${name}: syntax colours are the Dark+ / Light+ prototype values`, () => {
      expect(tokenColor(name, '')).toBe(p.text)
      expect(tokenColor(name, 'identifier')).toBe(p.text)
      expect(tokenColor(name, 'delimiter')).toBe(p.text)
      expect(tokenColor(name, 'keyword.sql')).toBe(p.keyword)
      expect(tokenColor(name, 'operator')).toBe(p.text)
      expect(tokenColor(name, 'operator.star')).toBe(p.keyword)
      expect(tokenColor(name, 'operator.keyword')).toBe(p.keyword)
      expect(tokenColor(name, 'string.sql')).toBe(p.string)
      expect(tokenColor(name, 'number.sql')).toBe(p.number)
      expect(tokenColor(name, 'identifier.quote.sql')).toBe(p.quoted)
      expect(MONACO_THEMES[name].rules.every((rule) => rule.fontStyle === undefined)).toBe(true)
    })

    it(`${name}: editor surfaces use the well, accent and accent tint`, () => {
      const colors = MONACO_THEMES[name].colors
      expect(colors['editor.background']).toBe(p.well)
      expect(colors['editorGutter.background']).toBe(p.well)
      expect(colors['editor.lineHighlightBackground']).toBe(p.currentLine)
      expect(colors['editorLineNumber.foreground']).toBe(p.lineNumber)
      expect(colors['editorCursor.foreground']).toBe(p.accent)
      expect(colors['editor.selectionBackground']).toBe(p.selection)
    })
  }

  it('keeps the token-* syntax colours in step with the Monaco palette', () => {
    const theme = readThemeTokens()
    const token = (themeName: string, name: string) =>
      theme[`--color-${themeName}-token-${name}`].slice(1)
    for (const [themeName, p] of [
      ['dark', PROTOTYPE['precision-studio-dark']],
      ['light', PROTOTYPE['precision-studio-light']],
    ] as const) {
      expect(token(themeName, 'text')).toBe(p.text)
      expect(token(themeName, 'keyword')).toBe(p.keyword)
      expect(token(themeName, 'string')).toBe(p.string)
      expect(token(themeName, 'number')).toBe(p.number)
      expect(token(themeName, 'identifier')).toBe(p.quoted)
    }
  })
})
