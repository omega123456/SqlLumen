import { describe, expect, it } from 'vitest'
import { encodeSemanticTokens } from '../../../../components/query-editor/semantic-highlighting/semantic-token-encoding'
import { SEMANTIC_TOKEN_LEGEND } from '../../../../components/query-editor/semantic-highlighting/semantic-token-legend'
import type { SqlIdentifierKind, SqlIdentifierSpan } from '../../../../workers/sql-identifier-types'

function span(kind: SqlIdentifierKind, lineNumber: number, startColumn: number): SqlIdentifierSpan {
  return { kind: kind, range: { lineNumber: lineNumber, startColumn: startColumn, length: 3 } }
}

function typeIndex(kind: SqlIdentifierKind): number {
  return SEMANTIC_TOKEN_LEGEND.tokenTypes.indexOf(kind)
}

describe('encodeSemanticTokens', () => {
  it('lists every identifier kind in the legend without modifiers', () => {
    expect(SEMANTIC_TOKEN_LEGEND.tokenTypes).toEqual([
      'database',
      'table',
      'tableAlias',
      'column',
      'columnAlias',
      'function',
    ])
    expect(SEMANTIC_TOKEN_LEGEND.tokenModifiers).toEqual([])
  })

  it('delta-encodes spans in document order', () => {
    const data = encodeSemanticTokens([
      span('column', 2, 5),
      span('table', 1, 15),
      span('tableAlias', 1, 8),
      span('function', 2, 12),
    ])

    expect(Array.from(data)).toEqual([
      ...[0, 7, 3, typeIndex('tableAlias'), 0],
      ...[0, 7, 3, typeIndex('table'), 0],
      ...[1, 4, 3, typeIndex('column'), 0],
      ...[0, 7, 3, typeIndex('function'), 0],
    ])
  })

  it('encodes no spans as an empty array', () => {
    expect(encodeSemanticTokens([])).toHaveLength(0)
  })
})
