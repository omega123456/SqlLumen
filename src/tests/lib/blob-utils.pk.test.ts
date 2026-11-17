import { describe, expect, it } from 'vitest'

import {
  base64ToBytes,
  buildEnvelopedPrimaryKeyPairs,
  convertBinaryPrimaryKeyValuesToEnvelopes,
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
  it('parses a bare (unprefixed) hex string', () => {
    const result = parseHexPrefixedBytes('FF00')
    expect(result.ok).toBe(true)
    if (result.ok) expect(Array.from(result.bytes)).toEqual([0xff, 0x00])
  })

  it('rejects an odd number of hex digits', () => {
    const result = parseHexPrefixedBytes('0xABC')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/odd/i)
  })
})

describe('convertBinaryPrimaryKeyValuesToEnvelopes', () => {
  it('passes through null values', () => {
    const columns = [column('id', true)]
    const result = convertBinaryPrimaryKeyValuesToEnvelopes(['id'], columns, { id: null })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.values.id).toBeNull()
  })

  it('converts an empty binary PK ("0x") into an empty envelope', () => {
    const columns = [column('id', true)]
    const result = convertBinaryPrimaryKeyValuesToEnvelopes(['id'], columns, { id: '0x' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(isBlobEnvelope(result.values.id)).toBe(true)
      expect((result.values.id as BlobEnvelope).kind).toBe('empty')
    }
  })
})

describe('buildEnvelopedPrimaryKeyPairs', () => {
  it('converts a binary PK hex value into an enveloped pair', () => {
    const columns = [column('id', true)]
    const result = buildEnvelopedPrimaryKeyPairs(['id'], columns, {
      id: '0xABCDEF01',
      name: 'ignored',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.pairs.length).toBe(1)
      expect(result.pairs[0][0]).toBe('id')
      expect(Array.from(expectBytes(result.pairs[0][1]))).toEqual([0xab, 0xcd, 0xef, 0x01])
    }
  })

  it('passes non-binary PK values through unchanged', () => {
    const columns = [column('id', false)]
    const result = buildEnvelopedPrimaryKeyPairs(['id'], columns, { id: 42 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.pairs).toEqual([['id', 42]])
  })
})
