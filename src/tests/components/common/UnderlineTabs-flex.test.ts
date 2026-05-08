import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Regression test: the UnderlineTabBar's `.bar` class must not grow in a
 * column flex container. When used inside SchemaInfoTab (a column flex layout),
 * `flex-grow: 1` on `.bar` causes the tab rail to expand vertically to fill
 * all available space, producing oversized/misaligned tabs.
 *
 * The `.bar` element is meant to be a fixed-height horizontal rail; it should
 * have `flex: 0 0 auto` by default, and only grow when inside `.barWrapper`.
 */

const cssPath = resolve(__dirname, '../../../components/common/UnderlineTabs.module.css')
const css = readFileSync(cssPath, 'utf8')

// Extract the standalone .bar { ... } block (not .barWrapper > .bar)
function getBarBlock(): string {
  const lines = css.split('\n')
  let inside = false
  let braceDepth = 0
  let block = ''
  for (const line of lines) {
    if (!inside && /^\.\bbar\b\s*\{/.test(line.trim())) {
      inside = true
      braceDepth = 0
    }
    if (inside) {
      block += line + '\n'
      braceDepth += (line.match(/\{/g) || []).length
      braceDepth -= (line.match(/\}/g) || []).length
      if (braceDepth === 0) break
    }
  }
  return block
}

// Extract the .barWrapper > .bar { ... } block
function getBarWrapperBarBlock(): string {
  const lines = css.split('\n')
  let inside = false
  let braceDepth = 0
  let block = ''
  for (const line of lines) {
    if (!inside && /\.barWrapper\s*>\s*\.bar\s*\{/.test(line.trim())) {
      inside = true
      braceDepth = 0
    }
    if (inside) {
      block += line + '\n'
      braceDepth += (line.match(/\{/g) || []).length
      braceDepth -= (line.match(/\}/g) || []).length
      if (braceDepth === 0) break
    }
  }
  return block
}

describe('UnderlineTabs .bar flex properties', () => {
  it('.bar should not use flex-grow: 1 in base rule', () => {
    const bar = getBarBlock()
    expect(bar).toBeTruthy()
    // Base .bar must use flex: 0 0 auto so it doesn't grow in column flex parents
    expect(bar, '.bar must use flex: 0 0 auto').toMatch(/flex:\s*0\s+0\s+auto/)
  })

  it('.bar should have width: 100% in base rule', () => {
    const bar = getBarBlock()
    expect(bar).toBeTruthy()
    expect(bar, '.bar must have width: 100%').toMatch(/width:\s*100%/)
  })
})

describe('UnderlineTabs .barWrapper > .bar flex properties', () => {
  it('.barWrapper > .bar should use flex: 1 1 0', () => {
    const block = getBarWrapperBarBlock()
    expect(block).toBeTruthy()
    expect(block, '.barWrapper > .bar must use flex: 1 1 0').toMatch(/flex:\s*1\s+1\s+0/)
  })

  it('.barWrapper > .bar should set width: auto', () => {
    const block = getBarWrapperBarBlock()
    expect(block).toBeTruthy()
    expect(block, '.barWrapper > .bar must have width: auto').toMatch(/width:\s*auto/)
  })
})

describe('UnderlineTabs .barSuffix alignment', () => {
  it('barSuffix should use align-self: flex-start not padding-bottom', () => {
    const barSuffixMatch = css.match(/\.barSuffix\s*\{[^}]*\}/)
    expect(barSuffixMatch, '.barSuffix block must exist').toBeTruthy()
    const block = barSuffixMatch![0]
    expect(block).toMatch(/align-self:\s*flex-start/)
    expect(block).not.toMatch(/padding-bottom/)
  })
})

describe('UnderlineTabs .bar overflow / scrollbar-gutter', () => {
  it('base .bar should use overflow-x: auto not scroll', () => {
    const bar = getBarBlock()
    expect(bar).toBeTruthy()
    const match = bar.match(/overflow-x:\s*(\w+)/)
    expect(match, '.bar must declare overflow-x').toBeTruthy()
    expect(match![1], '.bar overflow-x must be auto').toBe('auto')
  })

  it('.barScrollable should use overflow-x: auto with a reserved scrollbar lane', () => {
    const barScrollableMatch = css.match(/\.barScrollable\s*\{[^}]*\}/)
    expect(barScrollableMatch, '.barScrollable block must exist').toBeTruthy()
    const block = barScrollableMatch![0]
    expect(block).toMatch(/overflow-x:\s*auto/)
    expect(block).toMatch(/--underline-tab-scrollbar-reserve:\s*var\(--grid-scrollbar-size\)/)
    expect(block).toMatch(/grid-template-rows:[^;]*var\(--underline-tab-scrollbar-reserve\)/)
  })

  it('should not have scrollbar-gutter (does not work for horizontal overflow)', () => {
    const bar = getBarBlock()
    expect(bar).toBeTruthy()
    expect(bar).not.toMatch(/scrollbar-gutter/)
  })

  it('scrollbar-button should be hidden to prevent floating arrow icons', () => {
    expect(css).toMatch(/\.bar::-webkit-scrollbar-button\s*\{[^}]*display:\s*none/)
  })
})
