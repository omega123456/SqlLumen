import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/styles/vendor/glide-overlays.css'), 'utf8')

describe('vendor/glide-overlays.css', () => {
  it('scopes Glide host styles to the host data attribute', () => {
    expect(css).toContain('[data-sqllumen-glide-host] .dvn-scroller')
    expect(css).toContain('[data-sqllumen-glide-host] .gdg-cell-edit')
    expect(css).not.toContain('.glide-grid-host')
  })

  it('uses stable portal selectors for the Glide editor overlay', () => {
    expect(css).toContain('#portal .gdg-d19meir1')
    expect(css).toContain('max-width: var(--d19meir1-2, 400px)')
    expect(css).toContain('#portal .gdg-d19meir1.sqllumen-glide-editor-overlay.gdg-pad')
    expect(css).toContain('--sqllumen-grid-editor-control-height: 22px')
    expect(css).toContain('var(--d19meir1-3, var(--spacing-grid-row))')
    expect(css).toContain('var(--sqllumen-grid-editor-control-height)')
    expect(css).not.toMatch(/padding:\s*0\s*!important/)
    expect(css).not.toContain(":has([data-testid='fk-lookup-trigger'])")
  })

  it('styles no editor markup that SqlLumen renders itself', () => {
    expect(css).not.toContain('.td-')
  })
})
