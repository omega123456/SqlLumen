const DOUBLED_QUOTE_LENGTH = 2
const BLOCK_COMMENT_DELIMITER_LENGTH = 2
const LINE_COMMENT_DASHES_LENGTH = 2
const LAST_ASCII_CONTROL_CODE = 0x1f

export function isEscapedChar(text: string, position: number): boolean {
  let isEscaped = false
  let scanPosition = position - 1
  while (text[scanPosition] === '\\') {
    isEscaped = !isEscaped
    scanPosition--
  }
  return isEscaped
}

function isWhitespaceOrControl(character: string): boolean {
  return /\s/.test(character) || character.charCodeAt(0) <= LAST_ASCII_CONTROL_CODE
}

export const IDENTIFIER_CHARACTER = /[a-zA-Z0-9_$]/
export const PAREN_DEPTH_CHANGE_FORWARD: Record<string, number> = { '(': 1, ')': -1 }
export const PAREN_DEPTH_CHANGE_BACKWARD: Record<string, number> = { ')': 1, '(': -1 }
export const NOT_FOUND = -1
export const QUOTED_IDENTIFIER_CHARACTERS: ReadonlySet<string> = new Set(['`', '"'])

interface ForwardCharacterScan {
  text: string
  stopCharacter: string
  limit: number
}

function canScanForwardTo(scan: ForwardCharacterScan, index: number): boolean {
  return index < scan.limit && scan.text[index] !== scan.stopCharacter
}

export function canScanBackwardTo(text: string, index: number, stopCharacter: string): boolean {
  return index >= 0 && text[index] !== stopCharacter
}

export function isIdentifierCharacterAt(text: string, index: number): boolean {
  return index >= 0 && IDENTIFIER_CHARACTER.test(text[index])
}

function isUnescapedQuoteAt(text: string, index: number, quote: string): boolean {
  return text[index] === quote && !isEscapedChar(text, index)
}

function canScanForwardToBlockCommentClose(text: string, index: number, limit: number): boolean {
  const isCloseAt = text[index] === '*' && text[index + 1] === '/'
  return index + 1 < limit && !isCloseAt
}

function canScanBackwardToBlockCommentOpen(text: string, index: number): boolean {
  return index >= 0 && !isBlockCommentOpenAt(text, index)
}

function isQuoteCharacter(character: string): boolean {
  return character === "'" || character === '"'
}

function isLineCommentDashesAt(text: string, index: number): boolean {
  const startsWithDashes = text[index] === '-' && text[index + 1] === '-'
  if (!startsWithDashes) return false
  const characterAfterDashes = index + LINE_COMMENT_DASHES_LENGTH
  return characterAfterDashes < text.length && isWhitespaceOrControl(text[characterAfterDashes])
}

function isLineCommentMarkerAt(text: string, index: number): boolean {
  return text[index] === '#' || isLineCommentDashesAt(text, index)
}

function isBlockCommentOpenAt(text: string, index: number): boolean {
  return text[index] === '/' && text[index + 1] === '*'
}

function isBlockCommentCloseAt(text: string, index: number): boolean {
  return index >= 1 && text[index] === '/' && text[index - 1] === '*'
}

function isDoubledQuoteAt(text: string, index: number, limit: number): boolean {
  return index + 1 < limit && text[index + 1] === text[index]
}

function findLineStart(text: string, position: number): number {
  let lineStart = position
  while (canScanBackwardTo(text, lineStart - 1, '\n')) lineStart--
  return lineStart
}

function skipQuotedForward(text: string, quoteIndex: number, limit: number): number {
  const quote = text[quoteIndex]
  let scanIndex = quoteIndex + 1
  while (scanIndex < limit) {
    if (!isUnescapedQuoteAt(text, scanIndex, quote)) {
      scanIndex++
      continue
    }
    if (isDoubledQuoteAt(text, scanIndex, limit)) {
      scanIndex += DOUBLED_QUOTE_LENGTH
      continue
    }
    return scanIndex
  }
  return scanIndex
}

function skipBacktickForward(text: string, backtickIndex: number, limit: number): number {
  const scan: ForwardCharacterScan = { text: text, stopCharacter: '`', limit: limit }
  let scanIndex = backtickIndex + 1
  while (canScanForwardTo(scan, scanIndex)) scanIndex++
  return scanIndex
}

function findBlockCommentCloseForward(text: string, from: number, limit: number): number {
  let scanIndex = from
  while (canScanForwardToBlockCommentClose(text, scanIndex, limit)) {
    scanIndex++
  }
  return scanIndex
}

function skipToLineEnd(text: string, from: number, limit: number): number {
  const scan: ForwardCharacterScan = { text: text, stopCharacter: '\n', limit: limit }
  let scanIndex = from
  while (canScanForwardTo(scan, scanIndex)) scanIndex++
  return scanIndex
}

function skipLiteralForward(text: string, index: number): number | null {
  const character = text[index]
  if (isQuoteCharacter(character)) return skipQuotedForward(text, index, text.length)
  if (character === '`') return skipBacktickForward(text, index, text.length)
  return null
}

function findLineCommentStart(text: string, position: number): number {
  for (let scanIndex = findLineStart(text, position); scanIndex <= position; scanIndex++) {
    const literalEnd = skipLiteralForward(text, scanIndex)
    const isLiteralCoveringPosition = literalEnd !== null && literalEnd > position
    if (isLiteralCoveringPosition) return NOT_FOUND
    if (literalEnd !== null) {
      scanIndex = literalEnd
      continue
    }
    if (isLineCommentMarkerAt(text, scanIndex)) return scanIndex
  }
  return NOT_FOUND
}

export function lineCommentJumpTarget(text: string, position: number): number | null {
  const lineCommentStart = findLineCommentStart(text, position)
  const isInsideLineComment = lineCommentStart >= 0 && lineCommentStart <= position
  return isInsideLineComment ? lineCommentStart - 1 : null
}

function findBlockCommentOpenBackward(text: string, closeIndex: number): number {
  let scanIndex = closeIndex - BLOCK_COMMENT_DELIMITER_LENGTH
  while (canScanBackwardToBlockCommentOpen(text, scanIndex)) scanIndex--
  return scanIndex
}

function stepBackOverTrivia(text: string, position: number): number | null {
  if (/\s/.test(text[position])) return position - 1
  if (isBlockCommentCloseAt(text, position)) {
    const openIndex = findBlockCommentOpenBackward(text, position)
    return Math.max(openIndex - 1, NOT_FOUND)
  }
  return lineCommentJumpTarget(text, position)
}

export function skipBackwardWhitespaceAndComments(text: string, position: number): number {
  let scanPosition = position
  while (scanPosition >= 0) {
    const nextPosition = stepBackOverTrivia(text, scanPosition)
    if (nextPosition === null) return scanPosition
    scanPosition = nextPosition
  }
  return scanPosition
}

function stepForwardOverTrivia(text: string, position: number): number | null {
  if (/\s/.test(text[position])) return position + 1
  if (isBlockCommentOpenAt(text, position)) {
    const contentStart = position + BLOCK_COMMENT_DELIMITER_LENGTH
    const closeIndex = findBlockCommentCloseForward(text, contentStart, text.length)
    return closeIndex + BLOCK_COMMENT_DELIMITER_LENGTH
  }
  if (isLineCommentMarkerAt(text, position)) return skipToLineEnd(text, position, text.length)
  return null
}

export function _skipForwardWhitespaceAndComments(text: string, position: number): number {
  let scanPosition = position
  while (scanPosition < text.length) {
    const nextPosition = stepForwardOverTrivia(text, scanPosition)
    if (nextPosition === null) return scanPosition
    scanPosition = nextPosition
  }
  return scanPosition
}

export function skipNonCodeForward(
  text: string,
  index: number,
  cursorPosition: number
): number | null {
  const character = text[index]
  if (isQuoteCharacter(character)) return skipQuotedForward(text, index, cursorPosition)
  if (character === '`') return skipBacktickForward(text, index, cursorPosition)
  if (isBlockCommentOpenAt(text, index)) {
    const contentStart = index + BLOCK_COMMENT_DELIMITER_LENGTH
    return findBlockCommentCloseForward(text, contentStart, cursorPosition) + 1
  }
  if (isLineCommentMarkerAt(text, index)) return skipToLineEnd(text, index, cursorPosition)
  return null
}

function skipQuotedBackward(text: string, closingIndex: number): number {
  const quote = text[closingIndex]
  let scanIndex = closingIndex - 1
  while (scanIndex >= 0) {
    if (!isUnescapedQuoteAt(text, scanIndex, quote)) {
      scanIndex--
      continue
    }
    const isDoubledQuote = scanIndex >= 1 && text[scanIndex - 1] === quote
    if (isDoubledQuote) {
      scanIndex -= DOUBLED_QUOTE_LENGTH
      continue
    }
    return scanIndex
  }
  return scanIndex
}

function skipBacktickBackward(text: string, closingIndex: number): number {
  let scanIndex = closingIndex - 1
  while (canScanBackwardTo(text, scanIndex, '`')) scanIndex--
  return scanIndex
}

export function skipNonCodeBackward(text: string, index: number): number | null {
  const character = text[index]
  if (isQuoteCharacter(character)) return skipQuotedBackward(text, index)
  if (character === '`') return skipBacktickBackward(text, index)
  if (isBlockCommentCloseAt(text, index)) return findBlockCommentOpenBackward(text, index)
  return null
}
