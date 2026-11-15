import { describe, expect, it } from 'vitest'
import { gridTabPanelClassNameFor } from '../../../components/query-editor/result-panel/result-panel-model'

const CONTAINMENT_AND_ISOLATION_UTILITIES = [
  'contain-layout',
  'contain-paint',
  'contain-style',
  'isolate',
]

describe('ResultPanel grid layout isolation', () => {
  it('paint- and layout-contains a mounted grid view so it does not invalidate Monaco siblings', () => {
    const gridPanelUtilities = gridTabPanelClassNameFor('grid', 3).split(' ')

    expect(gridPanelUtilities).toEqual(expect.arrayContaining(CONTAINMENT_AND_ISOLATION_UTILITIES))
  })
})
