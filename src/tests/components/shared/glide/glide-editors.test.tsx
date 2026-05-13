import { describe, expect, it } from 'vitest'
import { computeRequestedEditorWidth } from '../../../../components/shared/glide/glide-editors'

describe('computeRequestedEditorWidth', () => {
  it('keeps the cell width when no markers are present', () => {
    expect(computeRequestedEditorWidth(80, 0)).toBe(80)
  })

  it('expands width to preserve a 2/3 field and 1/3 marker split', () => {
    expect(computeRequestedEditorWidth(38, 1)).toBe(152)
    expect(computeRequestedEditorWidth(80, 2)).toBe(204)
  })

  it('does not shrink already-wide cells', () => {
    expect(computeRequestedEditorWidth(240, 1)).toBe(240)
  })
})
