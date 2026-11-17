import { describe, expect, it } from 'vitest'
import { joinClassNames } from '../../lib/class-names'

describe('joinClassNames', () => {
  it('joins the class names with single spaces', () => {
    expect(joinClassNames(['flex', 'items-center'])).toBe('flex items-center')
  })

  it('drops empty and missing entries', () => {
    expect(joinClassNames(['flex', '', undefined, 'gap-2'])).toBe('flex gap-2')
  })

  it('returns an empty string when nothing is left', () => {
    expect(joinClassNames([undefined, ''])).toBe('')
  })
})
