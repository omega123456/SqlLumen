import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dataGridPrecisionCss = readFileSync(
  resolve(process.cwd(), 'src/styles/data-grid-precision.css'),
  'utf8'
)

describe('data-grid-precision header cell stacking context', () => {
  it('should not apply overflow:hidden to header cells (causes z-index issues with sticky positioning)', () => {
    // The generic .rdg-precision .rdg-cell rule applies overflow:hidden to ALL cells.
    // Header cells (.rdg-header-row .rdg-cell) are position:sticky and overflow:hidden
    // on sticky elements interferes with z-index stacking in Chromium during scroll.
    // The header-specific rule must override overflow back to 'clip' or 'visible',
    // or the generic rule must exclude header cells.
    const genericCellRule = dataGridPrecisionCss.match(/\.rdg-precision\s+\.rdg-cell\s*\{([^}]+)\}/)
    expect(genericCellRule).not.toBeNull()
    const genericCellBody = genericCellRule![1]
    const hasOverflowHidden = /overflow:\s*hidden/.test(genericCellBody)

    if (hasOverflowHidden) {
      // Then header cells must have an override
      const headerCellRule = dataGridPrecisionCss.match(
        /\.rdg-precision\s+\.rdg-header-row\s+\.rdg-cell\s*\{([^}]+)\}/
      )
      expect(headerCellRule).not.toBeNull()
      const headerCellBody = headerCellRule![1]
      const headerOverridesOverflow = /overflow:\s*(clip|visible)/.test(headerCellBody)
      expect(headerOverridesOverflow).toBe(true)
    }
  })

  it('should set explicit background-color on header cells so they are opaque (display:contents on row means row bg never paints)', () => {
    const headerCellRule = dataGridPrecisionCss.match(
      /\.rdg-precision\s+\.rdg-header-row\s+\.rdg-cell\s*\{([^}]+)\}/
    )
    expect(headerCellRule).not.toBeNull()
    const headerCellBody = headerCellRule![1]
    expect(headerCellBody).toMatch(/background-color:\s*var\(--result-grid-header-bg\)/)
  })

  it('should set explicit z-index on header row or header cells to prevent data rows from overlapping', () => {
    // Sticky header needs z-index to stay above scrolled body rows.
    // The custom CSS should ensure header has z-index defined.
    const headerRowRule = dataGridPrecisionCss.match(
      /\.rdg-precision\s+\.rdg-header-row\s*\{([^}]+)\}/
    )
    const headerCellRule = dataGridPrecisionCss.match(
      /\.rdg-precision\s+\.rdg-header-row\s+\.rdg-cell\s*\{([^}]+)\}/
    )
    const headerHasZIndex =
      (headerRowRule && /z-index/.test(headerRowRule[1])) ||
      (headerCellRule && /z-index/.test(headerCellRule[1]))
    expect(headerHasZIndex).toBe(true)
  })

  it('keeps header cells sticky, opaque, and above body cells', () => {
    const headerCellRule = dataGridPrecisionCss.match(
      /\.rdg-precision\s+\.rdg-header-row\s+\.rdg-cell\s*\{([^}]+)\}/
    )
    const headerCellHoverRule = dataGridPrecisionCss.match(
      /\.rdg-precision\s+\.rdg-header-row\s+\.rdg-cell:hover\s*\{([^}]+)\}/
    )
    expect(headerCellRule).not.toBeNull()
    expect(headerCellHoverRule).not.toBeNull()
    expect(headerCellRule![1]).toMatch(/position:\s*sticky/)
    expect(headerCellRule![1]).toMatch(/inset-block-start:\s*0/)
    expect(headerCellRule![1]).toMatch(/contain:\s*none/)
    expect(headerCellRule![1]).toMatch(/z-index:\s*20/)
    expect(headerCellHoverRule![1]).toMatch(/background-color:\s*color-mix\(/)
    expect(headerCellHoverRule![1]).not.toMatch(/background-color:\s*rgba\(/)
  })
})

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

  it('overrides readonly-cell styling inside selected rows', () => {
    expect(dataGridPrecisionCss).toMatch(
      /\.rdg-precision \.rdg-row-precision-selected \.rdg-readonly-cell[\s\S]*?opacity:\s*1\s*!important/
    )
    expect(dataGridPrecisionCss).toMatch(
      /\.rdg-precision \.rdg-row-precision-selected \.rdg-readonly-cell[\s\S]*?background-color:.*result-grid-row-selected-bg.*!important/
    )
  })

  it('has checkbox cell centering styles', () => {
    expect(dataGridPrecisionCss).toMatch(/\.rdg-precision \.rdg-checkbox-cell/)
    expect(dataGridPrecisionCss).toMatch(/\.rdg-checkbox-cell[\s\S]*?justify-content:\s*center/)
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
