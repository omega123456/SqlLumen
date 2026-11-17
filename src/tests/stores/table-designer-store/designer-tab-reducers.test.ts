import { describe, expect, it } from 'vitest'
import {
  applyDesignerSchemaEdit,
  discardDesignerChanges,
  patchDesignerTab,
  removeDesignerTab,
} from '../../../stores/table-designer-store/designer-tab-reducers'
import {
  createBlankSchema,
  createDefaultTabState,
} from '../../../stores/table-designer-store/designer-schema'
import type { TableDesignerTabState } from '../../../stores/table-designer-store'

function createTab(overrides: Partial<TableDesignerTabState> = {}): TableDesignerTabState {
  return {
    ...createDefaultTabState({
      mode: 'create',
      connectionId: 'conn-1',
      databaseName: 'shop',
      objectName: '',
    }),
    ...overrides,
  }
}

describe('designer tab reducers', () => {
  it('patches an existing tab and ignores a missing one', () => {
    const state = { tabs: { 'tab-1': createTab() } }
    const patched = patchDesignerTab(state, { tabId: 'tab-1', partial: { ddl: 'CREATE' } })
    expect(patched.tabs['tab-1'].ddl).toBe('CREATE')
    expect(patchDesignerTab(state, { tabId: 'missing', partial: { ddl: 'x' } })).toBe(state)
  })

  it('applies a schema edit and recomputes dirtiness', () => {
    const state = { tabs: { 'tab-1': createTab({ validationErrors: { tableName: 'x' } }) } }
    const schema = { ...createBlankSchema(), tableName: 'orders' }
    const edited = applyDesignerSchemaEdit(state, { tabId: 'tab-1', edit: { schema: schema } })
    expect(edited.tabs['tab-1'].currentSchema.tableName).toBe('orders')
    expect(edited.tabs['tab-1'].isDirty).toBe(true)
    expect(edited.tabs['tab-1'].validationErrors).toEqual({ tableName: 'x' })
    expect(applyDesignerSchemaEdit(state, { tabId: 'missing', edit: { schema: schema } })).toBe(
      state
    )
  })

  it('returns the same state when discarding or removing a missing tab', () => {
    const state = { tabs: {} }
    expect(discardDesignerChanges(state, 'missing')).toBe(state)
    expect(removeDesignerTab(state, 'missing')).toBe(state)
  })

  it('removes a tab', () => {
    const removed = removeDesignerTab({ tabs: { 'tab-1': createTab() } }, 'tab-1')
    expect(removed.tabs).toEqual({})
  })
})
