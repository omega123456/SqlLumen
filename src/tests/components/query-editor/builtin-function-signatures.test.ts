import { describe, it, expect } from 'vitest'
import { SQL_BUILTIN_FUNCTIONS } from '../../../components/query-editor/sql-keywords'
import {
  BUILTIN_FUNCTION_SIGNATURES,
  getBuiltinSignature,
  getSignatureLabel,
} from '../../../components/query-editor/builtin-function-signatures'

describe('builtin-function-signatures', () => {
  describe('BUILTIN_FUNCTION_SIGNATURES map', () => {
    it('contains entries for common functions', () => {
      expect(BUILTIN_FUNCTION_SIGNATURES.has('CONCAT')).toBe(true)
      expect(BUILTIN_FUNCTION_SIGNATURES.has('SUBSTRING')).toBe(true)
      expect(BUILTIN_FUNCTION_SIGNATURES.has('DATE_FORMAT')).toBe(true)
      expect(BUILTIN_FUNCTION_SIGNATURES.has('IF')).toBe(true)
      expect(BUILTIN_FUNCTION_SIGNATURES.has('COALESCE')).toBe(true)
      expect(BUILTIN_FUNCTION_SIGNATURES.has('COUNT')).toBe(true)
      expect(BUILTIN_FUNCTION_SIGNATURES.has('NOW')).toBe(true)
      expect(BUILTIN_FUNCTION_SIGNATURES.has('ROUND')).toBe(true)
      expect(BUILTIN_FUNCTION_SIGNATURES.has('ABS')).toBe(true)
      expect(BUILTIN_FUNCTION_SIGNATURES.has('JSON_EXTRACT')).toBe(true)
    })

    it('has valid structure for each entry', () => {
      for (const [key, sig] of BUILTIN_FUNCTION_SIGNATURES) {
        expect(key, `Key should be truthy`).toBeTruthy()
        const label = getSignatureLabel(key, sig)
        expect(label, `label for ${key} should be truthy`).toBeTruthy()
        expect(sig.returnType, `returnType for ${key} should be truthy`).toBeTruthy()
        expect(sig.documentation, `documentation for ${key} should be truthy`).toBeTruthy()
        expect(Array.isArray(sig.parameters), `parameters for ${key} should be array`).toBe(true)
      }
    })

    it('all parameter labels are substrings of the signature label', () => {
      for (const [key, sig] of BUILTIN_FUNCTION_SIGNATURES) {
        const label = getSignatureLabel(key, sig)
        for (const param of sig.parameters) {
          expect(
            label.includes(param.label),
            `"${param.label}" is not a substring of "${label}" for function ${key}`
          ).toBe(true)
        }
      }
    })

    it('covers ALL functions from SQL_BUILTIN_FUNCTIONS', () => {
      const missing: string[] = []
      for (const fnName of SQL_BUILTIN_FUNCTIONS) {
        if (!BUILTIN_FUNCTION_SIGNATURES.has(fnName)) {
          missing.push(fnName)
        }
      }
      expect(missing, `Missing entries for: ${missing.join(', ')}`).toHaveLength(0)
    })

    it('has uppercase keys matching SQL_BUILTIN_FUNCTIONS casing', () => {
      for (const fnName of SQL_BUILTIN_FUNCTIONS) {
        // Keys should match the SQL_BUILTIN_FUNCTIONS casing exactly
        expect(BUILTIN_FUNCTION_SIGNATURES.has(fnName), `Missing key for "${fnName}"`).toBe(true)
      }
    })
  })

  describe('getBuiltinSignature', () => {
    it('looks up functions case-insensitively', () => {
      expect(getBuiltinSignature('concat')).toBeDefined()
      expect(getBuiltinSignature('CONCAT')).toBeDefined()
      expect(getBuiltinSignature('Concat')).toBeDefined()
    })

    it('returns the same result regardless of case', () => {
      expect(getBuiltinSignature('concat')).toEqual(getBuiltinSignature('CONCAT'))
    })

    it('returns undefined for unknown functions', () => {
      expect(getBuiltinSignature('NOT_A_REAL_FUNCTION_XYZ')).toBeUndefined()
    })

    it('returns correct signature for CAST (special-syntax)', () => {
      const sig = getBuiltinSignature('CAST')
      expect(sig).toBeDefined()
      expect(sig!.documentation).toMatch(/Also:/i)
    })

    it('returns correct signature for TRIM (special-syntax)', () => {
      const sig = getBuiltinSignature('trim')
      expect(sig).toBeDefined()
      expect(sig!.documentation).toMatch(/Also:/i)
    })

    it('returns correct signature for EXTRACT (special-syntax)', () => {
      const sig = getBuiltinSignature('extract')
      expect(sig).toBeDefined()
      expect(sig!.documentation).toMatch(/unit/i)
    })

    it('returns correct signature for CONCAT', () => {
      const sig = getBuiltinSignature('CONCAT')
      expect(sig).toBeDefined()
      expect(sig!.label).toBe('CONCAT(str1, str2, ...)')
      expect(sig!.parameters).toHaveLength(3)
      expect(sig!.returnType).toBe('VARCHAR')
    })

    it('returns correct signature for NOW (optional fsp parameter)', () => {
      const sig = getBuiltinSignature('NOW')
      expect(sig).toBeDefined()
      expect(sig!.parameters).toHaveLength(1)
      expect(sig!.parameters[0].label).toBe('fsp (optional)')
      expect(sig!.returnType).toBe('DATETIME')
    })

    it('returns correct signature for COUNT', () => {
      const sig = getBuiltinSignature('COUNT')
      expect(sig).toBeDefined()
      expect(sig!.parameters.length).toBeGreaterThan(0)
    })

    it('returns correct signature for DATE_FORMAT', () => {
      const sig = getBuiltinSignature('DATE_FORMAT')
      expect(sig).toBeDefined()
      expect(sig!.parameters).toHaveLength(2)
      expect(sig!.parameters[0].label).toBe('date')
      expect(sig!.parameters[1].label).toBe('format')
    })
  })
})
