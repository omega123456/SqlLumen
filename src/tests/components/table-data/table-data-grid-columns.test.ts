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
    const [descriptor] = buildColumnDescriptors({
      columns: [makeColumn()],
      isReadOnly: false,
      hasPrimaryKey: true,
    })
    expect(descriptor.editorType).toBe('json')
  })

  it('keeps generated columns read-only in an editable table', () => {
    const [storedColumn, generatedColumn] = buildColumnDescriptors({
      columns: [
        makeColumn({ name: 'price', dataType: 'DECIMAL' }),
        makeColumn({ name: 'total', dataType: 'DECIMAL', isGenerated: true }),
      ],
      isReadOnly: false,
      hasPrimaryKey: true,
    })
    expect(storedColumn.editable).toBe(true)
    expect(generatedColumn.editable).toBe(false)
  })
})
