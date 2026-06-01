import { describe, expect, it } from 'vitest'

import {
  base64ToBytes,
  buildEnvelopedPkPairs,
  convertBinaryPkValuesToEnvelopes,
  isBlobEnvelope,
  parseHexPrefixedBytes,
} from '../../lib/blob-utils'
import type { BlobEnvelope, TableDataColumnMeta } from '../../types/schema'

function column(name: string, isBinary: boolean): TableDataColumnMeta {
  return {
    name,
    dataType: isBinary ? 'varbinary' : 'int',
    isBooleanAlias: false,
    isNullable: false,
    isPrimaryKey: true,
    isUniqueKey: false,
    hasDefault: false,
    columnDefault: null,
    isBinary,
    isAutoIncrement: false,
  }
}

function expectBytes(value: unknown): Uint8Array {
  expect(isBlobEnvelope(value)).toBe(true)
  const envelope = value as BlobEnvelope
  expect(envelope.kind).toBe('bytes')
  return base64ToBytes(envelope.base64 as string)
}

describe('parseHexPrefixedBytes', () => {
  it('parses a 0x-prefixed lowercase hex string', () => {
    const result = parseHexPrefixedBytes('0xabcdef01')
    expect(result.ok).toBe(true)
    if (result.ok) expect(Array.from(result.bytes)).toEqual([0xab, 0xcd, 0xef, 0x01])
  })

  it('parses a 0X-prefixed uppercase hex string', () => {
    const result = parseHexPrefixedBytes('0XABCDEF01')
    expect(result.ok).toBe(true)
    if (result.ok) expect(Array.from(result.bytes)).toEqual([0xab, 0xcd, 0xef, 0x01])
  })

  it('parses a bare (unprefixed) hex string', () => {
    const result = parseHexPrefixedBytes('FF00')
    expect(result.ok).toBe(true)
    if (result.ok) expect(Array.from(result.bytes)).toEqual([0xff, 0x00])
  })

  it('treats a bare "0x" as zero bytes', () => {
    const result = parseHexPrefixedBytes('0x')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.bytes.length).toBe(0)
  })

  it('rejects an odd number of hex digits', () => {
    const result = parseHexPrefixedBytes('0xABC')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/odd/i)
  })

  it('rejects non-hex characters', () => {
    const result = parseHexPrefixedBytes('0xZZ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/non-hex/i)
  })
})

describe('convertBinaryPkValuesToEnvelopes', () => {
  it('converts a binary PK hex value into a bytes envelope with matching bytes', () => {
    const columns = [column('id', true)]
    const result = convertBinaryPkValuesToEnvelopes(['id'], columns, { id: '0xABCDEF01' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Array.from(expectBytes(result.values.id))).toEqual([0xab, 0xcd, 0xef, 0x01])
    }
  })

  it('leaves non-binary PK values unchanged', () => {
    const columns = [column('id', false)]
    const result = convertBinaryPkValuesToEnvelopes(['id'], columns, { id: '0x12' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.values.id).toBe('0x12')
  })

  it('passes through values that are already blob envelopes', () => {
    const envelope: BlobEnvelope = { __sqllumen_blob__: true, kind: 'bytes', base64: 'qg==' }
    const columns = [column('id', true)]
    const result = convertBinaryPkValuesToEnvelopes(['id'], columns, { id: envelope })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.values.id).toBe(envelope)
  })

  it('passes through null values', () => {
    const columns = [column('id', true)]
    const result = convertBinaryPkValuesToEnvelopes(['id'], columns, { id: null })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.values.id).toBeNull()
  })

  it('converts an empty binary PK ("0x") into an empty envelope', () => {
    const columns = [column('id', true)]
    const result = convertBinaryPkValuesToEnvelopes(['id'], columns, { id: '0x' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(isBlobEnvelope(result.values.id)).toBe(true)
      expect((result.values.id as BlobEnvelope).kind).toBe('empty')
    }
  })

  it('returns an error result for malformed hex on a binary PK (does not throw)', () => {
    const columns = [column('id', true)]
    const result = convertBinaryPkValuesToEnvelopes(['id'], columns, { id: '0xZZ' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/id/)
  })

  it('converts only the binary component of a composite key', () => {
    const columns = [column('tenant_id', false), column('external_ref', true)]
    const result = convertBinaryPkValuesToEnvelopes(['tenant_id', 'external_ref'], columns, {
      tenant_id: 7,
      external_ref: '0xFF',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.values.tenant_id).toBe(7)
      expect(Array.from(expectBytes(result.values.external_ref))).toEqual([0xff])
    }
  })

  it('returns a fresh copy and does not mutate the input record', () => {
    const columns = [column('id', true)]
    const input = { id: '0xAB' }
    const result = convertBinaryPkValuesToEnvelopes(['id'], columns, input)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.values).not.toBe(input)
    expect(input.id).toBe('0xAB')
  })
})

describe('buildEnvelopedPkPairs', () => {
  it('converts a binary PK hex value into an enveloped pair', () => {
    const columns = [column('id', true)]
    const result = buildEnvelopedPkPairs(['id'], columns, { id: '0xABCDEF01', name: 'ignored' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.pairs.length).toBe(1)
      expect(result.pairs[0][0]).toBe('id')
      expect(Array.from(expectBytes(result.pairs[0][1]))).toEqual([0xab, 0xcd, 0xef, 0x01])
    }
  })

  it('passes non-binary PK values through unchanged', () => {
    const columns = [column('id', false)]
    const result = buildEnvelopedPkPairs(['id'], columns, { id: 42 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.pairs).toEqual([['id', 42]])
  })

  it('returns an error result for malformed binary-PK hex', () => {
    const columns = [column('id', true)]
    const result = buildEnvelopedPkPairs(['id'], columns, { id: '0xZZ' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/id/)
  })

  it('preserves the order of pkColumns in the returned pairs', () => {
    const columns = [column('tenant_id', false), column('external_ref', true)]
    const result = buildEnvelopedPkPairs(['tenant_id', 'external_ref'], columns, {
      external_ref: '0xFF',
      tenant_id: 7,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.pairs.map((pair) => pair[0])).toEqual(['tenant_id', 'external_ref'])
      expect(result.pairs[0][1]).toBe(7)
      expect(Array.from(expectBytes(result.pairs[1][1]))).toEqual([0xff])
    }
  })
})
