import { describe, expect, it } from 'vitest'
import { joinClassNames } from '../../lib/class-names'
import { FOCUS_RING } from '../../lib/focus-ring'

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

describe('FOCUS_RING', () => {
  it('draws the shadow ring only for keyboard focus, in both themes', () => {
    const classes = FOCUS_RING.split(' ')
    expect(classes).toContain('focus-visible:outline-none')
    expect(classes).toContain('focus-visible:shadow-light-focus-ring')
    expect(classes).toContain('dark:focus-visible:shadow-dark-focus-ring')
  })
})
