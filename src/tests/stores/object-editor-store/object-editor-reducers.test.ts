import { describe, expect, it } from 'vitest'
import {
  initObjectEditorTab,
  patchObjectEditorTabState,
  removeObjectEditorTab,
  type ObjectEditorTabMeta,
} from '../../../stores/object-editor-store/object-editor-reducers'

const META: ObjectEditorTabMeta = {
  connectionId: 'conn-1',
  database: 'shop',
  objectName: 'active_users',
  objectType: 'view',
  mode: 'alter',
}

describe('object editor reducers', () => {
  it('initialises a tab once', () => {
    const state = initObjectEditorTab({ tabs: {} }, { tabId: 'tab-1', meta: META })
    expect(state.tabs['tab-1']).toMatchObject({ ...META, content: '', isLoading: false })
    expect(initObjectEditorTab(state, { tabId: 'tab-1', meta: META })).toBe(state)
  })

  it('patches an existing tab only', () => {
    const state = initObjectEditorTab({ tabs: {} }, { tabId: 'tab-1', meta: META })
    const patched = patchObjectEditorTabState(state, {
      tabId: 'tab-1',
      partial: { content: 'SELECT 1' },
    })
    expect(patched.tabs['tab-1'].content).toBe('SELECT 1')
    expect(patchObjectEditorTabState(state, { tabId: 'missing', partial: {} })).toBe(state)
  })

  it('removes an existing tab only', () => {
    const state = initObjectEditorTab({ tabs: {} }, { tabId: 'tab-1', meta: META })
    expect(removeObjectEditorTab(state, 'tab-1')).toEqual({ tabs: {} })
    expect(removeObjectEditorTab(state, 'missing')).toBe(state)
  })
})
