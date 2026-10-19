import { describe, expect, it } from 'vitest'
import { cssRule } from '../../helpers/css-source'

// Prototype `.dz-grid`: 32px layer header, 6/8px cells, accent-tint selection with a 3px accent.
describe.each([
  'components/table-designer/ColumnEditor.module.css',
  'components/table-designer/IndexEditor.module.css',
  'components/table-designer/ForeignKeyEditor.module.css',
])('%s — designer grid', (file) => {
  it('uses the 32px layer header', () => {
    const header = cssRule(file, '.headerCell')
    expect(header).toContain('height: var(--grid-header-height);')
    expect(header).toContain('padding: 0 8px;')
    expect(header).toContain('background: var(--surface-container);')
  })

  it('pads cells 6px by 8px', () => {
    expect(cssRule(file, '.bodyCell')).toContain('padding: 6px 8px;')
  })

  it('selects rows with the accent tint and a 3px accent edge', () => {
    expect(cssRule(file, '.selectedRow, .row.selectedRow:hover')).toBe(
      'background: var(--fill-accent-tint);'
    )
    expect(cssRule(file, '.rowAccent')).toContain('width: 3px;')
    expect(cssRule(file, '.selectedRow .rowAccent')).toBe('background: var(--primary);')
  })
})
