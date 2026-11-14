import { readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  readSourceFile,
  readThemeTokens,
  stripCssComments,
  topLevelStatements,
} from '../helpers/tailwind-theme'
import { LEGACY_MODULES } from './legacy-css-modules'

const SRC = path.resolve(process.cwd(), 'src')
const PERMANENT_CSS_FILES = [
  'index.css',
  'styles/vendor/fonts.css',
  'styles/vendor/glide-overlays.css',
  'styles/vendor/hljs-theme.css',
  'styles/vendor/monaco-parameter-hints.css',
  'styles/vendor/monaco-suggest-widget.css',
]
const ALLOWED_INDEX_DIRECTIVES = ['@import', '@plugin', '@custom-variant', '@theme']
const SLIDER_MODULE = 'components/common/Slider.module.css'
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|hsla?\(|oklch\(/

const theme = readThemeTokens()

function sourceCssFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => file.endsWith('.css'))
    .filter((file) => !file.startsWith('tests/'))
    .sort()
}

function withoutComments(relativePath: string): string {
  return stripCssComments(readSourceFile(relativePath))
}

function filesMatching(files: readonly string[], pattern: RegExp): string[] {
  return files.filter((file) => pattern.test(withoutComments(file)))
}

function tokenNamesWithPrefix(prefix: string): string[] {
  return Object.keys(theme).filter((name) => name.startsWith(prefix))
}

function hexToRgb(hex: string): string {
  const value = parseInt(hex.slice(1), 16)
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`
}

function rgbOf(rgba: string): string {
  const channels = /rgba\((\d+), (\d+), (\d+), [\d.]+\)/.exec(rgba)
  if (!channels) throw new Error(`Not an rgba() value: ${rgba}`)
  return `${channels[1]}, ${channels[2]}, ${channels[3]}`
}

describe('css files — exact allowlist', () => {
  it('only the permanent files and the shrinking legacy list exist', () => {
    const expected = [...PERMANENT_CSS_FILES, ...LEGACY_MODULES].sort()
    expect(sourceCssFiles()).toEqual(expected)
  })

  it('lists each legacy module once', () => {
    expect(new Set(LEGACY_MODULES).size).toBe(LEGACY_MODULES.length)
  })

  it('keeps module styles out of the permanent files', () => {
    expect(PERMANENT_CSS_FILES.filter((file) => file.endsWith('.module.css'))).toEqual([])
  })
})

describe('index.css — directives', () => {
  const statements = topLevelStatements(readSourceFile('index.css'))

  it('contains only imports, plugins, custom variants and the theme', () => {
    const foreign = statements.filter(
      (statement) => !ALLOWED_INDEX_DIRECTIVES.some((directive) => statement.startsWith(directive))
    )
    expect(foreign).toEqual([])
  })

  it('declares the theme as static so unused variables stay available', () => {
    expect(statements).toContain('@theme static')
  })

  it('registers the scrollbar plugin and the app variants', () => {
    const variantNames = statements
      .filter((statement) => statement.startsWith('@custom-variant'))
      .map((statement) => statement.split(' ')[1])
    expect(
      statements.some((statement) => statement.startsWith('@plugin "tailwind-scrollbar"'))
    ).toBe(true)
    expect(variantNames).toEqual(['dark', 'mica', 'hover', 'window-blurred', 'resize-dragging'])
  })

  it('never applies utilities inside css rules', () => {
    const offenders = sourceCssFiles().filter((file) => /@apply\b/.test(withoutComments(file)))
    expect(offenders).toEqual([])
  })
})

describe('vendor css', () => {
  const vendorFiles = PERMANENT_CSS_FILES.filter((file) => file.startsWith('styles/vendor/'))

  it('has no colour literals', () => {
    expect(filesMatching(vendorFiles, COLOUR_LITERAL)).toEqual([])
  })
})

describe('@theme — paired light and dark tokens', () => {
  it.each(['--color-', '--shadow-'])('every light %s token has a dark twin and back', (family) => {
    const lightNames = tokenNamesWithPrefix(`${family}light-`)
    const darkNames = tokenNamesWithPrefix(`${family}dark-`)
    expect(lightNames.length).toBeGreaterThan(0)
    expect(lightNames.map((name) => name.replace('-light-', '-dark-')).sort()).toEqual(
      darkNames.sort()
    )
  })

  it('gives every animation a paused twin for the blurred window', () => {
    const animations = tokenNamesWithPrefix('--animate-').filter(
      (name) => !name.endsWith('-paused')
    )
    expect(animations.length).toBeGreaterThan(0)
    for (const name of animations) {
      expect(theme[`${name}-paused`], `${name} needs a paused twin`).toBe(`${theme[name]} paused`)
    }
  })

  it('gives every type ramp step a size-only twin', () => {
    const steps = tokenNamesWithPrefix('--text-').filter(
      (name) => !name.includes('--line-height') && !name.startsWith('--text-size-')
    )
    expect(steps.length).toBeGreaterThan(0)
    for (const name of steps) {
      expect(theme[name.replace('--text-', '--text-size-')]).toBe(theme[name])
      expect(theme[`${name}--line-height`], `${name} needs a line height`).toBeDefined()
    }
  })

  it('derives every alpha token from its base colour in both themes', () => {
    for (const themeName of ['dark', 'light']) {
      const primary = theme[`--color-${themeName}-primary`]
      const error = theme[`--color-${themeName}-error`]
      expect(rgbOf(theme[`--color-${themeName}-primary-a30`])).toBe(hexToRgb(primary))
      expect(rgbOf(theme[`--color-${themeName}-error-a20`])).toBe(hexToRgb(error))
    }
  })
})

describe('@theme — Fluent surfaces and text', () => {
  it.each([
    ['surface', '#202020', '#f3f3f3'],
    ['surface-container', '#272727', '#f9f9f9'],
    ['surface-container-low', '#272727', '#f9f9f9'],
    ['surface-container-high', '#2c2c2c', '#ffffff'],
    ['surface-container-lowest', '#1c1c1c', '#ffffff'],
    ['on-surface', '#ffffff', '#1b1b1b'],
    ['on-surface-variant', '#cfcfcf', '#5d5d5d'],
    ['outline', '#9d9d9d', '#6e6e6e'],
    ['text-disabled', '#717171', '#a3a3a3'],
    ['primary', '#4cc2ff', '#0067c0'],
    ['on-primary', '#000000', '#ffffff'],
    ['error', '#ff99a4', '#c42b1c'],
    ['error-container', '#442726', '#fde7e9'],
    ['warning', '#fce100', '#9d5d00'],
    ['warning-container', '#433519', '#fff4ce'],
    ['tertiary', '#6ccb5f', '#0f7b0f'],
    ['tertiary-container', '#393d1b', '#dff6dd'],
    ['stroke-text-field', '#9a9a9a', '#767676'],
    ['focus-outer', '#ffffff', '#1b1b1b'],
    ['focus-inner', '#000000', '#ffffff'],
  ])('%s is %s (dark) / %s (light)', (name, darkValue, lightValue) => {
    expect(theme[`--color-dark-${name}`]).toBe(darkValue)
    expect(theme[`--color-light-${name}`]).toBe(lightValue)
  })

  it.each([
    ['stroke-card', 'rgba(255, 255, 255, 0.07)', 'rgba(0, 0, 0, 0.07)'],
    ['fill-control', 'rgba(255, 255, 255, 0.06)', 'rgba(255, 255, 255, 0.7)'],
    ['stroke-control-bottom', 'rgba(255, 255, 255, 0.04)', 'rgba(0, 0, 0, 0.17)'],
    ['fill-subtle-hover', 'rgba(255, 255, 255, 0.06)', 'rgba(0, 0, 0, 0.04)'],
    ['fill-accent-tint', 'rgba(76, 194, 255, 0.15)', 'rgba(0, 103, 192, 0.11)'],
    ['smoke', 'rgba(0, 0, 0, 0.45)', 'rgba(0, 0, 0, 0.3)'],
  ])('%s alpha fill matches the proposal', (name, darkValue, lightValue) => {
    expect(theme[`--color-dark-${name}`]).toBe(darkValue)
    expect(theme[`--color-light-${name}`]).toBe(lightValue)
  })
})

describe('@theme — shape, elevation and heights', () => {
  it('uses 4 / 6 / 8px radii', () => {
    expect(theme['--radius-control']).toBe('4px')
    expect(theme['--radius-card']).toBe('6px')
    expect(theme['--radius-overlay']).toBe('8px')
  })

  it('uses the Fluent flyout and dialog shadows', () => {
    expect(theme['--shadow-dark-flyout']).toBe('0 8px 16px rgba(0, 0, 0, 0.26)')
    expect(theme['--shadow-light-flyout']).toBe('0 8px 16px rgba(0, 0, 0, 0.14)')
    expect(theme['--shadow-dark-dialog']).toBe(
      '0 32px 64px rgba(0, 0, 0, 0.37), 0 2px 21px rgba(0, 0, 0, 0.37)'
    )
    expect(theme['--shadow-light-dialog']).toBe(
      '0 32px 64px rgba(0, 0, 0, 0.19), 0 2px 21px rgba(0, 0, 0, 0.15)'
    )
  })

  it('draws the focus ring as a 1px inner and 3px outer shadow in both themes', () => {
    expect(theme['--shadow-dark-focus-ring']).toBe(
      '0 0 0 1px var(--color-dark-focus-inner), 0 0 0 3px var(--color-dark-focus-outer)'
    )
    expect(theme['--shadow-light-focus-ring']).toBe(
      '0 0 0 1px var(--color-light-focus-inner), 0 0 0 3px var(--color-light-focus-outer)'
    )
  })

  it('measures spacing in pixels', () => {
    expect(theme['--spacing']).toBe('4px')
  })

  it.each([
    ['--spacing-title-strip', '40px'],
    ['--spacing-command-bar', '44px'],
    ['--spacing-tab', '32px'],
    ['--spacing-tab-strip', '38px'],
    ['--spacing-control', '32px'],
    ['--spacing-status-bar', '24px'],
    ['--spacing-grid-row', '28px'],
    ['--spacing-grid-header', '32px'],
  ])('%s is %s', (name, value) => {
    expect(theme[name]).toBe(value)
  })

  it('drops the primary gradient, dropdown glow and glass blur', () => {
    const themeCss = Object.values(theme).join('\n')
    expect(themeCss).not.toMatch(/gradient\(/)
    expect(themeCss).not.toMatch(/blur\(/)
  })
})

describe('@theme — type', () => {
  it('uses Selawik for UI text and JetBrains Mono for code', () => {
    expect(theme['--font-body']).toContain("'Selawik'")
    expect(theme['--font-headline']).toContain("'Selawik'")
    expect(theme['--font-mono'].startsWith("'JetBrains Mono'")).toBe(true)
    expect(Object.values(theme).join('\n')).not.toMatch(/Manrope|'Inter'/)
  })

  it('defines the 28 / 20 / 14 / 13 / 12 ramp with 400 and 600 weights', () => {
    expect(theme['--text-title']).toBe('28px')
    expect(theme['--text-subtitle']).toBe('20px')
    expect(theme['--text-body']).toBe('14px')
    expect(theme['--text-row']).toBe('13px')
    expect(theme['--text-caption']).toBe('12px')
    expect(theme['--font-weight-regular']).toBe('400')
    expect(theme['--font-weight-semibold']).toBe('600')
  })

  it('carries a line height with every ramp size', () => {
    expect(theme['--text-title--line-height']).toBe('36px')
    expect(theme['--text-subtitle--line-height']).toBe('28px')
    expect(theme['--text-body--line-height']).toBe('20px')
    expect(theme['--text-row--line-height']).toBe('18px')
    expect(theme['--text-caption--line-height']).toBe('16px')
    expect(theme['--text-mono--line-height']).toBe('20px')
  })

  it('bundles Selawik and no longer imports Manrope or Inter', () => {
    const fontsCss = readSourceFile('styles/vendor/fonts.css')
    expect(fontsCss).toMatch(/font-family: 'Selawik'/)
    expect(fontsCss).toContain('selawik-regular.woff2')
    expect(fontsCss).toContain('selawik-semibold.woff2')
    expect(fontsCss).not.toMatch(/@fontsource\/(manrope|inter)/)
  })
})

describe('legacy module css — tokens are the single colour source', () => {
  const legacyModuleFiles = LEGACY_MODULES.filter((file) => file.endsWith('.module.css'))

  it('has no hard-coded colour literals', () => {
    expect(filesMatching(legacyModuleFiles, /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/)).toEqual([])
  })

  it('has no uppercase text transforms', () => {
    expect(filesMatching(legacyModuleFiles, /text-transform:\s*uppercase/)).toEqual([])
  })

  it('only uses gradients for the slider value fill', () => {
    const migrated = legacyModuleFiles.filter((file) => file !== SLIDER_MODULE)
    expect(filesMatching(migrated, /gradient\(/)).toEqual([])
  })
})
