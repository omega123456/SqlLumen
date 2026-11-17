import { describe, expect, it } from 'vitest'
import { joinClassNames } from '../../lib/class-names'

describe('joinClassNames', () => {
  it('joins the class names with single spaces', () => {
    expect(joinClassNames(['flex', 'items-center'])).toBe('flex items-center')
  })
})
