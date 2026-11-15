import { describe, expect, it } from 'vitest'
import { fieldChromeClassName, FIELD_CHROME } from '../../lib/class-names-field'

const MODIFIED = { modified: true, isNull: false }
const NULL_VALUE = { modified: false, isNull: true }

describe('fieldChromeClassName', () => {
  it('matches the shared field chrome for a plain valid field', () => {
    expect(fieldChromeClassName({ invalid: false })).toBe(FIELD_CHROME)
  })

  it('distinguishes invalid, modified and NULL fields from a plain field', () => {
    const variants = new Set([
      fieldChromeClassName({ invalid: false }),
      fieldChromeClassName({ invalid: true }),
      fieldChromeClassName({ invalid: false, fieldState: MODIFIED }),
      fieldChromeClassName({ invalid: false, fieldState: NULL_VALUE }),
    ])
    expect(variants.size).toBe(4)
  })

  it('lets invalid win over modified', () => {
    expect(fieldChromeClassName({ invalid: true, fieldState: MODIFIED })).toBe(
      fieldChromeClassName({ invalid: true })
    )
  })

  it('distinguishes the accent emphasis and the steady fill from a plain field', () => {
    const variants = new Set([
      fieldChromeClassName(),
      fieldChromeClassName({ emphasis: 'accent' }),
      fieldChromeClassName({ fill: 'steady' }),
    ])
    expect(variants.size).toBe(3)
  })

  it('lets a NULL value win over the accent emphasis', () => {
    expect(fieldChromeClassName({ emphasis: 'accent', fieldState: NULL_VALUE })).toBe(
      fieldChromeClassName({ fieldState: NULL_VALUE })
    )
  })
})
