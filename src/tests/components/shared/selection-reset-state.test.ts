import { describe, expect, it } from 'vitest'
import { nextSelectionResetState } from '../../../components/shared/selection-reset-state'

describe('nextSelectionResetState', () => {
  it('bumps the reset key when the checked rows are cleared', () => {
    expect(nextSelectionResetState({ resetKey: 2, prevCount: 3 }, 0)).toEqual({
      resetKey: 3,
      prevCount: 0,
    })
  })

  it('keeps the reset key while rows stay checked', () => {
    expect(nextSelectionResetState({ resetKey: 2, prevCount: 3 }, 5)).toEqual({
      resetKey: 2,
      prevCount: 5,
    })
  })

  it('keeps the reset key when nothing was checked before', () => {
    expect(nextSelectionResetState({ resetKey: 0, prevCount: 0 }, 0)).toEqual({
      resetKey: 0,
      prevCount: 0,
    })
  })
})
