import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const agGridPrecisionCss = readFileSync(
  resolve(process.cwd(), 'src/styles/ag-grid-precision.css'),
  'utf8'
)

describe('ag-grid-precision table-data editing styles', () => {
  it('uses dark-theme left border accent on editing rows (inline_editable_grid dark mock)', () => {
    expect(agGridPrecisionCss).toMatch(
      /\[data-theme='dark'\][\s\S]*?\.ag-theme-precision \.ag-row\.td-editing-row[\s\S]*?border-left:\s*2px solid var\(--primary\)/
    )
  })

  it('keeps base editing-row rule as background only (no border-left)', () => {
    const match = agGridPrecisionCss.match(/\.ag-theme-precision \.ag-row\.td-editing-row \{[^}]+\}/s)
    expect(match?.[0]).toBeTruthy()
    expect(match?.[0]).not.toContain('border-left')
  })

  it('replaces triangle modified marker with theme-specific markers', () => {
    expect(agGridPrecisionCss).not.toMatch(/border-top:\s*6px solid var\(--td-modified-cell-indicator\)/)
    expect(agGridPrecisionCss).toMatch(
      /\[data-theme='light'\][\s\S]*?\.td-modified-cell::after/
    )
    expect(agGridPrecisionCss).toMatch(
      /\[data-theme='dark'\][\s\S]*?\.td-modified-cell::before/
    )
  })

  it('does not alter the ag-row display mode for editing rows', () => {
    expect(agGridPrecisionCss).not.toMatch(
      /\.ag-theme-precision \.ag-row\.td-editing-row\s*\{[^}]*display:/s
    )
  })
})
