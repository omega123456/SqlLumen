import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/styles/data-grid-precision.css'), 'utf8')

describe('data-grid-precision.css', () => {
  it('contains Glide host and editor styles', () => {
    expect(css).toContain('.glide-grid-host')
    expect(css).toContain('.dvn-scroller')
    expect(css).toContain('#portal')
    expect(css).toContain('.gdg-cell-edit')
  })

  it('uses native Glide overlay chrome for cell editors', () => {
    const legacyShellSelector = `.td-cell-editor-${'shell'}`
    expect(css).not.toContain(legacyShellSelector)
    expect(css).toMatch(/#portal\s+\.td-cell-editor-input/)
    expect(css).toMatch(/background:\s*transparent/)
    expect(css).toMatch(/#portal\s+\.td-null-toggle/)
  })

  it('does not contain legacy react-data-grid selectors', () => {
    expect(css).not.toMatch(/\.rdg[-_]/)
    expect(css).not.toContain('react-data-grid')
  })
})
