import type { SqlIdentifierSpan } from '../../../workers/sql-identifier-types'
import { semanticTokenTypeIndex } from './semantic-token-legend'

const SEMANTIC_TOKEN_FIELD_COUNT = 5
const NO_TOKEN_MODIFIERS = 0

function compareSpanPositions(left: SqlIdentifierSpan, right: SqlIdentifierSpan): number {
  const lineDifference = left.range.lineNumber - right.range.lineNumber
  if (lineDifference !== 0) return lineDifference
  return left.range.startColumn - right.range.startColumn
}

export function encodeSemanticTokens(spans: SqlIdentifierSpan[]): Uint32Array {
  const sortedSpans = [...spans].sort(compareSpanPositions)
  const data = new Uint32Array(sortedSpans.length * SEMANTIC_TOKEN_FIELD_COUNT)
  let previousLine = 0
  let previousCharacter = 0
  sortedSpans.forEach((span, spanIndex) => {
    const line = span.range.lineNumber - 1
    const character = span.range.startColumn - 1
    const deltaLine = line - previousLine
    const deltaCharacter = deltaLine === 0 ? character - previousCharacter : character
    const token = [
      deltaLine,
      deltaCharacter,
      span.range.length,
      semanticTokenTypeIndex(span.kind),
      NO_TOKEN_MODIFIERS,
    ]
    data.set(token, spanIndex * SEMANTIC_TOKEN_FIELD_COUNT)
    previousLine = line
    previousCharacter = character
  })
  return data
}
