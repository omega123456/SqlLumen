import { describe, expect, it } from 'vitest'
import {
  cloneValue,
  computeIsDirty,
  createBlankSchema,
  createDefaultTabState,
  isCreateDraftReadyForDdl,
  normalizeLoadedSchema,
  resetSchemaFor,
} from '../../../stores/table-designer-store/designer-schema'
import type { TableDesignerTabState } from '../../../stores/table-designer-store'
import type { TableDesignerColumnDef } from '../../../types/schema'

function column(overrides: Partial<TableDesignerColumnDef> = {}): TableDesignerColumnDef {
  return {
    name: 'id',
    type: 'INT',
    length: '11',
    nullable: false,
    isPrimaryKey: true,
    isAutoIncrement: false,
    defaultValue: { tag: 'NO_DEFAULT' },
    comment: '',
    originalName: 'id',
    ...overrides,
  }
}

function tabFor(mode: 'create' | 'alter'): TableDesignerTabState {
  return createDefaultTabState({
    mode: mode,
    connectionId: 'conn',
    databaseName: 'db',
    objectName: 'users',
  })
}

function alterTabWithColumns(
  originalColumns: TableDesignerColumnDef[],
  currentColumns: TableDesignerColumnDef[]
): TableDesignerTabState {
  const tab = tabFor('alter')
  return {
    ...tab,
    originalSchema: { ...createBlankSchema(), columns: originalColumns },
    currentSchema: { ...createBlankSchema(), columns: currentColumns },
  }
}

describe('createDefaultTabState', () => {
  it('starts on the columns sub-tab with a blank schema', () => {
    const tab = tabFor('create')
    expect(tab.selectedSubTab).toBe('columns')
    expect(tab.currentSchema).toEqual(createBlankSchema())
    expect(tab.isDirty).toBe(false)
  })
})

describe('cloneValue', () => {
  it('returns a deep copy', () => {
    const source = { nested: { value: 1 } }
    const copy = cloneValue(source)
    expect(copy).toEqual(source)
    expect(copy.nested).not.toBe(source.nested)
  })
})

describe('normalizeLoadedSchema', () => {
  it('fills the default display length for integer columns without one', () => {
    const schema = {
      ...createBlankSchema(),
      columns: [column({ length: '' }), column({ type: 'TEXT', length: '' }), column()],
    }
    const lengths = normalizeLoadedSchema(schema).columns.map((loaded) => loaded.length)
    expect(lengths[0]).not.toBe('')
    expect(lengths.slice(1)).toEqual(['', '11'])
  })
})

describe('resetSchemaFor', () => {
  it('returns a blank schema in create mode', () => {
    expect(resetSchemaFor(tabFor('create'))).toEqual(createBlankSchema())
  })

  it('returns a copy of the original schema in alter mode', () => {
    const tab = alterTabWithColumns([column()], [])
    const reset = resetSchemaFor(tab)
    expect(reset.columns).toEqual([column()])
    expect(reset).not.toBe(tab.originalSchema)
  })

  it('falls back to the current schema before the original loads', () => {
    const tab = { ...tabFor('alter'), currentSchema: { ...createBlankSchema(), tableName: 'x' } }
    expect(resetSchemaFor(tab).tableName).toBe('x')
  })
})

describe('computeIsDirty', () => {
  it('compares alter tabs with the original ignoring equivalent modifiers', () => {
    expect(computeIsDirty(alterTabWithColumns([column()], [column()]))).toBe(false)
    expect(computeIsDirty(alterTabWithColumns([column()], [column({ typeModifier: '' })]))).toBe(
      false
    )
    expect(computeIsDirty(alterTabWithColumns([column()], [column({ comment: 'x' })]))).toBe(true)
    expect(computeIsDirty(tabFor('alter'))).toBe(false)
  })

  it('treats any started create draft as dirty', () => {
    expect(computeIsDirty(tabFor('create'))).toBe(false)
    const named = { ...tabFor('create'), currentSchema: { ...createBlankSchema(), tableName: 't' } }
    expect(computeIsDirty(named)).toBe(true)
  })
})

describe('isCreateDraftReadyForDdl', () => {
  it('requires a table name and no validation errors in create mode', () => {
    expect(isCreateDraftReadyForDdl(tabFor('create'))).toBe(false)
    const named = { ...tabFor('create'), currentSchema: { ...createBlankSchema(), tableName: 't' } }
    expect(isCreateDraftReadyForDdl(named)).toBe(true)
    expect(isCreateDraftReadyForDdl({ ...named, validationErrors: { x: 'bad' } })).toBe(false)
    expect(isCreateDraftReadyForDdl(tabFor('alter'))).toBe(true)
  })
})
