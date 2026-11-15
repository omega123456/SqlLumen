import { describe, expect, it } from 'vitest'
import { fieldChromeClassName, FIELD_CHROME } from '../../lib/class-names-field'

const MODIFIED = { modified: true, isNull: false }
const NULL_VALUE = { modified: false, isNull: true }

describe('fieldChromeClassName', () => {
  it('matches the shared field chrome for a plain valid field', () => {
    expect(fieldChromeClassName(false)).toBe(FIELD_CHROME)
  })

  it('distinguishes invalid, modified and NULL fields from a plain field', () => {
    const variants = new Set([
      fieldChromeClassName(false),
      fieldChromeClassName(true),
      fieldChromeClassName(false, MODIFIED),
      fieldChromeClassName(false, NULL_VALUE),
    ])
    expect(variants.size).toBe(4)
  })

  it('lets invalid win over modified', () => {
    expect(fieldChromeClassName(true, MODIFIED)).toBe(fieldChromeClassName(true))
  })
})
