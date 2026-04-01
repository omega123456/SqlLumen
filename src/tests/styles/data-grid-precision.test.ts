import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dataGridPrecisionCss = readFileSync(
  resolve(process.cwd(), 'src/styles/data-grid-precision.css'),
  'utf8'
)

describe('data-grid-precision editing styles', () => {
  it('uses dark-theme left border accent on editing rows', () => {
    expect(dataGridPrecisionCss).toMatch(
      /\[data-theme='dark'\][\s\S]*?\.rdg-precision \.rdg-editing-row[\s\S]*?border-left:\s*2px solid var\(--primary\)/
    )
  })

  it('has base editing-row rule with background', () => {
    expect(dataGridPrecisionCss).toMatch(/\.rdg-precision \.rdg-editing-row/)
    expect(dataGridPrecisionCss).toMatch(/--td-editing-row-bg/)
  })

  it('has theme-specific modified cell markers', () => {
    expect(dataGridPrecisionCss).toMatch(
      /\[data-theme='light'\][\s\S]*?\.rdg-precision \.rdg-modified-cell::after/
    )
    expect(dataGridPrecisionCss).toMatch(
      /\[data-theme='dark'\][\s\S]*?\.rdg-precision \.rdg-modified-cell::before/
    )
  })

  it('has cell editor shell styles for light and dark themes', () => {
    expect(dataGridPrecisionCss).toMatch(
      /\[data-theme='light'\][\s\S]*?\.rdg-precision \.td-cell-editor-shell/
    )
    expect(dataGridPrecisionCss).toMatch(
      /\[data-theme='dark'\][\s\S]*?\.rdg-precision \.td-cell-editor-shell/
    )
  })

  it('has NULL toggle styles', () => {
    expect(dataGridPrecisionCss).toMatch(/\.rdg-precision \.td-null-toggle/)
    expect(dataGridPrecisionCss).toMatch(/\.rdg-precision \.td-null-toggle\.td-null-active/)
  })

  it('has cell type classes matching design tokens', () => {
    expect(dataGridPrecisionCss).toMatch(/\.rdg-precision \.td-cell-mono-muted/)
    expect(dataGridPrecisionCss).toMatch(/\.rdg-precision \.td-cell-mono\b/)
    expect(dataGridPrecisionCss).toMatch(/\.rdg-precision \.td-cell-body/)
    expect(dataGridPrecisionCss).toMatch(/\.rdg-precision \.td-cell-primary/)
  })

  it('has light theme overrides', () => {
    expect(dataGridPrecisionCss).toMatch(/\[data-theme='light'\] \.rdg-precision/)
  })

  it('has unified editing class names', () => {
    expect(dataGridPrecisionCss).toMatch(/\.rdg-precision \.rdg-editing-row/)
    expect(dataGridPrecisionCss).toMatch(/\.rdg-precision \.rdg-modified-cell/)
    expect(dataGridPrecisionCss).toMatch(/\.rdg-precision \.rdg-readonly-cell/)
    expect(dataGridPrecisionCss).toMatch(/\.rdg-precision \.rdg-editable-cell/)
    expect(dataGridPrecisionCss).toMatch(/\.rdg-precision \.rdg-new-row/)
  })

  it('does not contain deprecated class names', () => {
    // Old table-data specific class names should be removed
    expect(dataGridPrecisionCss).not.toMatch(/\.rdg-precision \.td-editing-row\b/)
    expect(dataGridPrecisionCss).not.toMatch(/\.rdg-precision \.td-modified-cell\b/)
    expect(dataGridPrecisionCss).not.toMatch(/\.rdg-precision \.td-editable-cell\b/)
    expect(dataGridPrecisionCss).not.toMatch(/\.rdg-precision \.td-new-row\b/)
    // Old query-result specific class names should be removed
    expect(dataGridPrecisionCss).not.toMatch(/\.rdg-precision \.result-editing-row\b/)
    expect(dataGridPrecisionCss).not.toMatch(/\.rdg-precision \.cell-modified\b/)
    expect(dataGridPrecisionCss).not.toMatch(/\.rdg-precision \.col-readonly\b/)
    expect(dataGridPrecisionCss).not.toMatch(/\.rdg-precision \.col-editable\b/)
  })
})
