import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function readStyle(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

const css =
  readStyle('src/styles/data-grid-precision.css') +
  readStyle('src/styles/vendor/glide-overlays.css')

describe('data-grid-precision.css and vendor/glide-overlays.css', () => {
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
    expect(css).toMatch(/#portal\s+\.td-cell-editor-select/)
    expect(css).toMatch(/background:\s*transparent/)
    expect(css).toMatch(/#portal\s+\.td-null-toggle/)
  })

  it('uses stable portal selectors for cell editor styling', () => {
    expect(css).toMatch(/#portal\s+\.td-cell-editor-input/)
    expect(css).toMatch(/#portal\s+\.td-null-toggle/)
    expect(css).toContain('#portal .gdg-d19meir1')
    expect(css).toContain('max-width: var(--d19meir1-2, 400px)')
    expect(css).toContain('#portal .gdg-d19meir1.sqllumen-glide-editor-overlay.gdg-pad')
    expect(css).toContain('--sqllumen-grid-editor-control-height: 22px')
    expect(css).toContain('var(--d19meir1-3, var(--grid-row-height, 28px))')
    expect(css).toContain('var(--sqllumen-grid-editor-control-height)')
    expect(css).not.toMatch(/padding:\s*0\s*!important/)
    expect(css).not.toContain(":has([data-testid='fk-lookup-trigger'])")
  })
})
