import { describe, it, expect } from 'vitest'
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
  })
})
