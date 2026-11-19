import { describe, expect, it } from 'vitest'
import { DEFAULT_DATA_VIEW_STATE } from '../../../stores/data-view/data-view-defaults'
import { applyViewPatch, mergeViewPatches } from '../../../stores/data-view/data-view-reducers'

const PROGRESS = { verb: 'Copying' as const, done: 1, total: 2, cancellable: false, visible: true }

describe('data view reducers', () => {
  it('merges patched groups field by field and keeps untouched groups by reference', () => {
    const view = applyViewPatch(DEFAULT_DATA_VIEW_STATE, {
      mode: 'form',
      selection: { rowIndex: 3 },
      rowAction: PROGRESS,
    })
    expect(view.mode).toBe('form')
    expect(view.selection).toEqual({ rowIndex: 3, cell: null })
    expect(view.rowAction).toBe(PROGRESS)
    expect(view.layout).toBe(DEFAULT_DATA_VIEW_STATE.layout)
    expect(view.edit).toBe(DEFAULT_DATA_VIEW_STATE.edit)

    const cleared = applyViewPatch(view, { rowAction: null })
    expect(cleared.rowAction).toBeNull()
    expect(cleared.mode).toBe('form')
  })

  it('merges two patches so later group fields win and other fields survive', () => {
    const merged = mergeViewPatches(
      { edit: { draftRow: null, saveError: 'old' }, mode: 'grid' },
      { edit: { saveError: null }, checked: { ranges: [] } }
    )
    expect(merged.edit).toEqual({ draftRow: null, saveError: null })
    expect(merged.checked).toEqual({ ranges: [] })
    expect(merged.mode).toBe('grid')
    expect(merged.selection).toBeUndefined()
  })
})
