import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  readSourceFile,
  readThemeTokens,
  stripCssComments,
  topLevelStatements,
} from '../helpers/tailwind-theme'

const SRC = path.resolve(process.cwd(), 'src')
const VENDOR_CSS_FILES = [
  'styles/vendor/fonts.css',
  'styles/vendor/glide-overlays.css',
  'styles/vendor/hljs-theme.css',
  'styles/vendor/monaco-parameter-hints.css',
  'styles/vendor/monaco-paused-animations.css',
  'styles/vendor/monaco-suggest-widget.css',
  'styles/vendor/react-colorful.css',
  'styles/vendor/react-datepicker.css',
  'styles/vendor/react-datepicker-popover.css',
  'styles/vendor/react-resizable-panels.css',
]
const ALLOWED_CSS_FILES = ['index.css', ...VENDOR_CSS_FILES]
const VENDOR_FOREIGN_VARIABLES = [
  '--d19meir1-2',
  '--d19meir1-3',
  '--sqllumen-grid-editor-control-height',
]
const DARK_SELECTOR_PREFIX = '.dark '
const CSS_VARIABLE_REFERENCE = /var\((--[a-z0-9-]+)/g
const THEMED_VARIABLE = /^--(color|shadow)-(light|dark)-(.+)$/
const CSS_RULE = /([^{}]+)\{([^{}]*)\}/g
const ALLOWED_INDEX_DIRECTIVES = ['@import', '@plugin', '@custom-variant', '@theme']
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
  it('only index.css and the vendor files exist', () => {
    expect(sourceCssFiles()).toEqual([...ALLOWED_CSS_FILES].sort())
  })

  it('has no CSS module anywhere in the source tree', () => {
    expect(sourceCssFiles().filter((file) => file.endsWith('.module.css'))).toEqual([])
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
    expect(variantNames).toEqual([
      'dark',
      'mica',
      'hover',
      'window-blurred',
      'slider-thumb',
      'webkit-scrollbar',
      'webkit-scrollbar-track',
      'webkit-scrollbar-thumb',
      'webkit-scrollbar-thumb-hover',
      'svg',
      'canvas',
      'resize-dragging',
      'after-memory-section',
      'inside-pre',
      'outside-pre',
      'top-level-list',
      'second-level-list',
      'deep-list',
      'selectable-descendants',
    ])
  })

  it('never applies utilities inside css rules', () => {
    const offenders = sourceCssFiles().filter((file) => /@apply\b/.test(withoutComments(file)))
    expect(offenders).toEqual([])
  })
})

describe('preflight and base classes', () => {
  const indexHtml = readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8')
  const statements = topLevelStatements(readSourceFile('index.css'))

  function classesOf(openingTag: RegExp): string[] {
    const tag = openingTag.exec(indexHtml)?.[0] ?? ''
    const classValue = /class="([^"]*)"/.exec(tag)?.[1] ?? ''
    return classValue.split(/\s+/)
  }

  it('imports only the full tailwindcss entry, so no global element rules remain', () => {
    const imports = statements.filter((statement) => statement.startsWith('@import'))
    expect(imports).toEqual(["@import 'tailwindcss'"])
  })

  it('has one theme switch: the dark class, with no data-theme attribute', () => {
    expect(classesOf(/<html\b[^>]*>/s)).toContain('dark')
    expect(indexHtml).not.toContain('data-theme')
  })

  it('sets the page defaults through classes on html, body and #root', () => {
    expect(classesOf(/<html\b[^>]*>/s)).toEqual(
      expect.arrayContaining([
        'dark',
        'antialiased',
        'tab-8',
        'scheme-light',
        'dark:scheme-dark',
        'svg:max-w-full',
        'canvas:max-w-full',
        'selection:bg-light-fill-accent-tint',
        'dark:selection:bg-dark-fill-accent-tint',
        'selection:text-light-on-surface',
        'dark:selection:text-dark-on-surface',
      ])
    )
    expect(classesOf(/<body\b[^>]*>/s)).toEqual(
      expect.arrayContaining([
        'select-none',
        'font-body',
        'text-body',
        'bg-light-surface',
        'dark:bg-dark-surface',
        'mica:bg-transparent',
        'selectable-descendants:select-text',
      ])
    )
    expect(classesOf(/<div id="root"[^>]*>/)).toEqual(
      expect.arrayContaining(['h-full', 'flex', 'flex-col'])
    )
  })
})

interface CssRule {
  selectors: string[]
  body: string
}

function cssRules(relativePath: string): CssRule[] {
  const rules: CssRule[] = []
  for (const match of withoutComments(relativePath).matchAll(CSS_RULE)) {
    const selectors = match[1].split(',').map((selector) => selector.trim())
    rules.push({ selectors: selectors, body: match[2] })
  }
  return rules
}

function variablesReferencedBy(relativePath: string): string[] {
  return [...withoutComments(relativePath).matchAll(CSS_VARIABLE_REFERENCE)].map(
    (match) => match[1]
  )
}

function themedNames(relativePath: string, themeName: 'light' | 'dark'): string[] {
  const names = variablesReferencedBy(relativePath).flatMap((variable) => {
    const match = THEMED_VARIABLE.exec(variable)
    if (match === null || match[2] !== themeName) return []
    return [`${match[1]}-${match[3]}`]
  })
  return [...new Set(names)].sort()
}

function isDarkRule(rule: CssRule): boolean {
  return rule.selectors.every((selector) => selector.startsWith(DARK_SELECTOR_PREFIX))
}

function referencesDarkTheme(rule: CssRule): boolean {
  return /var\(--(color|shadow)-dark-/.test(rule.body)
}

describe('vendor css', () => {
  it('has no colour literals', () => {
    expect(filesMatching(VENDOR_CSS_FILES, COLOUR_LITERAL)).toEqual([])
  })

  it('reads only @theme tokens and the Glide overlay variables', () => {
    const known = new Set([...Object.keys(theme), ...VENDOR_FOREIGN_VARIABLES])
    const unknown = VENDOR_CSS_FILES.flatMap((file) =>
      variablesReferencedBy(file)
        .filter((variable) => !known.has(variable))
        .map((variable) => `${file}: ${variable}`)
    )
    expect(unknown).toEqual([])
  })

  it('reads dark theme variables only inside .dark rules', () => {
    const offenders = VENDOR_CSS_FILES.flatMap((file) =>
      cssRules(file)
        .filter((rule) => referencesDarkTheme(rule) && !isDarkRule(rule))
        .map((rule) => `${file}: ${rule.selectors.join(', ')}`)
    )
    expect(offenders).toEqual([])
  })

  it.each(VENDOR_CSS_FILES)('%s gives every light colour and shadow a dark twin', (file) => {
    expect(themedNames(file, 'dark')).toEqual(themedNames(file, 'light'))
  })

  it('pauses Monaco animations while the window is unfocused or the panel is retained', () => {
    const css = withoutComments('styles/vendor/monaco-paused-animations.css')
    expect(css).toContain("html[data-window-focused='false'] .monaco-editor *")
    expect(css).toContain('[data-animation-paused] .monaco-editor *')
    expect(css).toContain('animation-play-state: paused')
  })
})

function productionSourceFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => !file.startsWith('tests/'))
}

describe('animations — paused while the window is blurred', () => {
  const ANIMATION_UTILITY = /animate-[a-z0-9-]+/g
  const BLURRED_PAUSED_UTILITY = /window-blurred:(?:[a-z-]+:)*(animate-[a-z0-9-]+-paused)/g

  it('pairs every animate-* utility with a window-blurred paused twin in the same file', () => {
    const unpaired = productionSourceFiles().flatMap((file) => {
      const source = readSourceFile(file)
      const paused = new Set([...source.matchAll(BLURRED_PAUSED_UTILITY)].map((match) => match[1]))
      const animations = [...source.matchAll(ANIMATION_UTILITY)].map((match) => match[0])
      return animations
        .filter((animation) => !animation.endsWith('-paused'))
        .filter((animation) => !paused.has(`${animation}-paused`))
        .map((animation) => `${file}: ${animation}`)
    })
    expect([...new Set(unpaired)]).toEqual([])
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

describe('@theme — control shapes and focus shadows', () => {
  it.each([
    ['--radius-track', '2px'],
    ['--radius-switch', '10px'],
    ['--radius-round', '50%'],
    ['--border-width-check', '1.6px'],
    ['--text-size-glyph', '10px'],
    ['--font-weight-extrabold', '800'],
  ])('%s is %s', (name, value) => {
    expect(theme[name]).toBe(value)
  })

  it.each([
    ['field-error', 'error', ''],
    ['slider-thumb-hover', 'primary-a15', '0 0 0 4px '],
    ['slider-thumb-focus', 'primary-a25', '0 0 0 4px '],
  ])('%s shadow reads the %s colour in both themes', (name, colour, offset) => {
    const underline = name === 'field-error' ? 'inset 0 -1px 0 ' : offset
    for (const themeName of ['dark', 'light']) {
      expect(theme[`--shadow-${themeName}-${name}`]).toBe(
        `${underline}var(--color-${themeName}-${colour})`
      )
    }
  })
})

describe('@theme — tab strip shadows', () => {
  it.each([
    ['divider-bottom', 'inset 0 -1px 0 ', 'stroke-divider'],
    ['strip-tint', 'inset 0 0 0 999px ', 'surface-strip'],
  ])('%s shadow reads the %s colour in both themes', (name, offset, colour) => {
    for (const themeName of ['dark', 'light']) {
      expect(theme[`--shadow-${themeName}-${name}`]).toBe(
        `${offset}var(--color-${themeName}-${colour})`
      )
    }
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
