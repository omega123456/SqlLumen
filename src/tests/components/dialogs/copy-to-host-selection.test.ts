import { describe, expect, it } from 'vitest'
import {
  selectionWithCategoryToggled,
  selectionWithPreselectedObject,
  toggledSetMember,
} from '../../../components/dialogs/copy-to-host-selection'
import { createEmptyCopySelection, type CopyableObjects } from '../../../lib/copy-to-host-commands'

const OBJECTS: CopyableObjects = {
  tables: [
    { name: 'users', estimatedRows: 10 },
    { name: 'orders', estimatedRows: 20 },
  ],
  procedures: ['refresh_totals'],
  functions: [],
  triggers: [],
  events: [],
}

describe('copy to host selection', () => {
  it('toggles a set member without mutating the source set', () => {
    const members = new Set(['a'])
    expect([...toggledSetMember(members, 'b')]).toEqual(['a', 'b'])
    expect([...toggledSetMember(members, 'a')]).toEqual([])
    expect([...members]).toEqual(['a'])
  })

  it('selects a preselected object only when the source has it', () => {
    const empty = createEmptyCopySelection()
    const selected = selectionWithPreselectedObject(empty, OBJECTS, {
      category: 'tables',
      name: 'users',
    })
    expect([...selected.tables]).toEqual(['users'])
    expect(
      selectionWithPreselectedObject(empty, OBJECTS, { category: 'tables', name: 'missing' })
    ).toBe(empty)
  })

  it('selects a whole category, then clears it when everything is selected', () => {
    const toggle = { category: 'tables' as const, names: ['users', 'orders'] }
    const all = selectionWithCategoryToggled(createEmptyCopySelection(), toggle)
    expect([...all.tables]).toEqual(['users', 'orders'])
    expect(selectionWithCategoryToggled(all, toggle).tables.size).toBe(0)
  })
})
