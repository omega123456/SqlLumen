import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const agGridPrecisionCss = readFileSync(
  resolve(process.cwd(), 'src/styles/ag-grid-precision.css'),
  'utf8'
)

describe('ag-grid-precision table-data editing styles', () => {
  it('does not define a left border accent for editing or new rows', () => {
    expect(agGridPrecisionCss).not.toMatch(
      /\.ag-theme-precision \.ag-row\.td-editing-row\s*\{[^}]*border-left:/s
    )
    expect(agGridPrecisionCss).not.toMatch(
      /\.ag-theme-precision \.ag-row\.td-new-row\s*\{[^}]*border-left:/s
    )
  })

  it('does not alter the ag-row display mode for editing rows', () => {
    expect(agGridPrecisionCss).not.toMatch(
      /\.ag-theme-precision \.ag-row\.td-editing-row\s*\{[^}]*display:/s
    )
  })
})
