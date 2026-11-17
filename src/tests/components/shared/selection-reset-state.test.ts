import { describe, expect, it } from 'vitest'
import { nextSelectionResetState } from '../../../components/shared/selection-reset-state'

describe('nextSelectionResetState', () => {
  it('bumps the reset key when the checked rows are cleared', () => {
    expect(nextSelectionResetState({ resetKey: 2, prevCount: 3 }, 0)).toEqual({
      resetKey: 3,
      prevCount: 0,
    })
  })
})
