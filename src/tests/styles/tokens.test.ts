import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Vitest stubs CSS imports (including ?raw) to empty strings, so read the sources directly.
const SRC = path.resolve(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(path.join(SRC, rel), 'utf8')
const tokensCss = read('styles/tokens.css')
const fontsCss = read('styles/fonts.css')

/**
 * Contract for the Fluent token layer (ADR: tokens are the single colour source).
 * Values come from the approved proposal's "Token map", "Shape and elevation",
 * "Heights" and "Type ramp" sections.
 */

function block(selector: string): Record<string, string> {
  const start = tokensCss.indexOf(`${selector} {`)
  expect(start, `missing ${selector} block`).toBeGreaterThanOrEqual(0)
  const end = tokensCss.indexOf('\n}', start)
  const body = tokensCss.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '')
  const vars: Record<string, string> = {}
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    vars[match[1]] = match[2].replace(/\s+/g, ' ').trim()
  }
  return vars
}

const dark = block(':root')
const light = block("[data-theme='light']")

function hexToTriplet(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

const componentCssWithoutComments = (
  readdirSync(path.join(SRC, 'components'), { recursive: true }) as string[]
)
  .filter((file) => file.endsWith('.module.css'))
  .map(
    (file) =>
      [
        `components/${file.split(path.sep).join('/')}`,
        read(path.join('components', file)).replace(/\/\*[\s\S]*?\*\//g, ''),
      ] as const
  )

describe('tokens.css — Fluent surfaces and text', () => {
  it.each([
    ['--surface', '#202020', '#f3f3f3'],
    ['--surface-container', '#272727', '#f9f9f9'],
    ['--surface-container-low', '#272727', '#f9f9f9'],
    ['--surface-container-high', '#2c2c2c', '#ffffff'],
    ['--surface-container-lowest', '#1c1c1c', '#ffffff'],
    ['--on-surface', '#ffffff', '#1b1b1b'],
    ['--on-surface-variant', '#cfcfcf', '#5d5d5d'],
    ['--outline', '#9d9d9d', '#6e6e6e'],
    ['--text-disabled', '#717171', '#a3a3a3'],
    ['--primary', '#4cc2ff', '#0067c0'],
    ['--on-primary', '#000000', '#ffffff'],
    ['--error', '#ff99a4', '#c42b1c'],
    ['--error-container', '#442726', '#fde7e9'],
    ['--warning', '#fce100', '#9d5d00'],
    ['--warning-container', '#433519', '#fff4ce'],
    ['--tertiary', '#6ccb5f', '#0f7b0f'],
    ['--tertiary-container', '#393d1b', '#dff6dd'],
    ['--stroke-text-field', '#9a9a9a', '#767676'],
    ['--focus-outer', '#ffffff', '#1b1b1b'],
    ['--focus-inner', '#000000', '#ffffff'],
  ])('%s is %s (dark) / %s (light)', (name, darkValue, lightValue) => {
    expect(dark[name]).toBe(darkValue)
    expect(light[name]).toBe(lightValue)
  })

  it.each([
    ['--stroke-card', 'rgba(255, 255, 255, 0.07)', 'rgba(0, 0, 0, 0.07)'],
    ['--fill-control', 'rgba(255, 255, 255, 0.06)', 'rgba(255, 255, 255, 0.7)'],
    ['--stroke-control-bottom', 'rgba(255, 255, 255, 0.04)', 'rgba(0, 0, 0, 0.17)'],
    ['--fill-subtle-hover', 'rgba(255, 255, 255, 0.06)', 'rgba(0, 0, 0, 0.04)'],
    ['--fill-accent-tint', 'rgba(76, 194, 255, 0.15)', 'rgba(0, 103, 192, 0.11)'],
    ['--smoke', 'rgba(0, 0, 0, 0.45)', 'rgba(0, 0, 0, 0.3)'],
  ])('%s alpha fill matches the proposal', (name, darkValue, lightValue) => {
    expect(dark[name]).toBe(darkValue)
    expect(light[name]).toBe(lightValue)
  })

  it.each([
    ['--primary', '--primary-rgb'],
    ['--surface-tint', '--surface-tint-rgb'],
    ['--error', '--error-rgb'],
    ['--on-surface', '--on-surface-rgb'],
  ])('%s and %s stay in sync in both themes', (hexName, rgbName) => {
    expect(dark[rgbName]).toBe(hexToTriplet(dark[hexName]))
    expect(light[rgbName]).toBe(hexToTriplet(light[hexName]))
  })

  it('semantic tokens are defined once and follow the theme primitives', () => {
    expect(dark['--ui-modal-bg']).toBe('var(--surface-container-high)')
    expect(dark['--ui-list-item-selected-bg']).toBe('var(--fill-accent-tint)')
    expect(light['--ui-modal-bg']).toBeUndefined()
    expect(light['--grid-row-height']).toBeUndefined()
  })
})

describe('tokens.css — shape, elevation and heights', () => {
  it('uses 4 / 6 / 8px radii', () => {
    expect(dark['--radius-control']).toBe('4px')
    expect(dark['--radius-card']).toBe('6px')
    expect(dark['--radius-overlay']).toBe('8px')
    expect(dark['--radius-2xs']).toBe('var(--radius-control)')
    expect(dark['--ui-elevated-surface-radius']).toBe('var(--radius-card)')
  })

  it('uses the Fluent flyout and dialog shadows', () => {
    expect(dark['--shadow-flyout']).toBe('0 8px 16px rgba(0, 0, 0, 0.26)')
    expect(light['--shadow-flyout']).toBe('0 8px 16px rgba(0, 0, 0, 0.14)')
    expect(dark['--shadow-dialog']).toBe(
      '0 32px 64px rgba(0, 0, 0, 0.37), 0 2px 21px rgba(0, 0, 0, 0.37)'
    )
    expect(light['--shadow-dialog']).toBe(
      '0 32px 64px rgba(0, 0, 0, 0.19), 0 2px 21px rgba(0, 0, 0, 0.15)'
    )
  })

  it.each([
    ['--title-strip-height', '40px'],
    ['--command-bar-height', '44px'],
    ['--tab-group-row-height', '44px'],
    ['--doc-tab-height', '32px'],
    ['--doc-tab-strip-height', '38px'],
    ['--control-height', '32px'],
    ['--status-bar-height', '24px'],
    ['--grid-row-height', '28px'],
    ['--grid-header-height', '32px'],
  ])('%s is %s', (name, value) => {
    expect(dark[name]).toBe(value)
  })

  it('drops the primary gradient, dropdown glow and glass blur', () => {
    expect(tokensCss).not.toMatch(/gradient\(/)
    expect(tokensCss).not.toMatch(/blur\(/)
    expect(dark['--ui-dropdown-trigger-open-shadow']).toBe('none')
    expect(dark['--primary-gradient-from']).toBeUndefined()
    expect(dark['--glass-blur']).toBeUndefined()
  })
})

describe('tokens.css — type', () => {
  it('uses Selawik for UI text and JetBrains Mono for code', () => {
    expect(dark['--font-body']).toContain("'Selawik'")
    expect(dark['--font-headline']).toContain("'Selawik'")
    expect(dark['--font-mono'].startsWith("'JetBrains Mono'")).toBe(true)
    expect(tokensCss).not.toMatch(/Manrope|'Inter'/)
  })

  it('defines the 28 / 20 / 14 / 13 / 12 ramp with 400 and 600 weights', () => {
    expect(dark['--type-title-size']).toBe('28px')
    expect(dark['--type-subtitle-size']).toBe('20px')
    expect(dark['--type-body-size']).toBe('14px')
    expect(dark['--type-row-size']).toBe('13px')
    expect(dark['--type-caption-size']).toBe('12px')
    expect(dark['--type-weight-regular']).toBe('400')
    expect(dark['--type-weight-semibold']).toBe('600')
  })

  it('turns the caps label into a 12px sentence-case style', () => {
    expect(dark['--type-label-caps']).toBe('var(--type-caption-size)')
    expect(dark['--type-label-caps-tracking']).toBe('normal')
  })

  it('bundles Selawik and no longer imports Manrope or Inter', () => {
    expect(fontsCss).toMatch(/font-family: 'Selawik'/)
    expect(fontsCss).toContain('selawik-regular.woff2')
    expect(fontsCss).toContain('selawik-semibold.woff2')
    expect(fontsCss).not.toMatch(/@fontsource\/(manrope|inter)/)
  })
})

describe('component CSS — tokens are the single colour source', () => {
  it('finds component stylesheets to check', () => {
    expect(componentCssWithoutComments.length).toBeGreaterThan(100)
  })

  it('has no hard-coded colour literals', () => {
    const offenders = componentCssWithoutComments
      .filter(([, css]) => /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/.test(css))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('has no uppercase text transforms', () => {
    const offenders = componentCssWithoutComments
      .filter(([, css]) => /text-transform:\s*uppercase/.test(css))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('only uses gradients for the slider value fill', () => {
    const offenders = componentCssWithoutComments
      .filter(([, css]) => /gradient\(/.test(css))
      .map(([path]) => path)
    expect(offenders).toEqual(['components/common/Slider.module.css'])
  })
})
