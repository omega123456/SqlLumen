import { describe, expect, it } from 'vitest'
import { buildColumnDescriptors } from '../../../components/table-data/table-data-grid-columns'
import type { TableDataColumnMeta } from '../../../types/schema'

function makeColumn(overrides: Partial<TableDataColumnMeta> = {}): TableDataColumnMeta {
  return {
    name: 'payload',
    dataType: 'JSON',
    isNullable: true,
    isPrimaryKey: false,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary: false,
    isBooleanAlias: false,
    isAutoIncrement: false,
    ...overrides,
  }
}

describe('buildColumnDescriptors', () => {
  it('marks JSON columns with the json editor type', () => {
    const [descriptor] = buildColumnDescriptors([makeColumn()], false, true)
    expect(descriptor.editorType).toBe('json')
  })

  it('keeps binary columns non-editable even if the data type text contains JSON elsewhere', () => {
    const [descriptor] = buildColumnDescriptors(
      [makeColumn({ dataType: 'BLOB', isBinary: true })],
      false,
      true
    )
    expect(descriptor.editorType).toBe('none')
  })
})
