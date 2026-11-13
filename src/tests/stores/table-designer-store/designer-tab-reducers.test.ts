import { describe, expect, it } from 'vitest'
import {
  applyDesignerSchemaEdit,
  discardDesignerChanges,
  initDesignerTab,
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
  it('initialises a tab only once', () => {
    const target = { mode: 'alter' as const, connectionId: 'c', databaseName: 'd', objectName: 'o' }
    const initialised = initDesignerTab({ tabs: {} }, { tabId: 'tab-1', target: target })
    expect(initialised.tabs['tab-1'].mode).toBe('alter')
    expect(initDesignerTab(initialised, { tabId: 'tab-1', target: target })).toBe(initialised)
  })

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

  it('discards changes back to a blank create schema', () => {
    const dirtyTab = createTab({
      currentSchema: { ...createBlankSchema(), tableName: 'draft' },
      isDirty: true,
      ddl: 'CREATE TABLE draft',
    })
    const discarded = discardDesignerChanges({ tabs: { 'tab-1': dirtyTab } }, 'tab-1')
    expect(discarded.tabs['tab-1'].currentSchema.tableName).toBe('')
    expect(discarded.tabs['tab-1'].isDirty).toBe(false)
    expect(discarded.tabs['tab-1'].isDdlLoading).toBe(true)
    expect(discarded.tabs['tab-1'].ddl).toBe('')
  })

  it('discards changes back to the original schema in alter mode', () => {
    const original = { ...createBlankSchema(), tableName: 'users' }
    const alterTab = createTab({
      mode: 'alter',
      originalSchema: original,
      currentSchema: { ...original, tableName: 'renamed' },
    })
    const discarded = discardDesignerChanges({ tabs: { 'tab-1': alterTab } }, 'tab-1')
    expect(discarded.tabs['tab-1'].currentSchema.tableName).toBe('users')
    expect(discarded.tabs['tab-1'].isDirty).toBe(false)
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
