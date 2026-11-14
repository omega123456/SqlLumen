import { stripLeadingSqlComments } from '../sql-utils'

const BACKTICK_PAIR_LENGTH = 2

const COMMENT_MARKER_LENGTH = 2

const SELECT_KEYWORD_LENGTH = 'SELECT'.length

export function normalizeIdentifier(identifier: string): string {
  const trimmed = identifier.trim()
  if (isBacktickQuoted(trimmed)) {
    return trimmed.slice(1, -1).replace(/``/g, '`')
  }
  return trimmed
}

function isBacktickQuoted(identifier: string): boolean {
  const hasRoomForQuotes = identifier.length >= BACKTICK_PAIR_LENGTH
  return hasRoomForQuotes && identifier.startsWith('`') && identifier.endsWith('`')
}

export function splitQualifiedIdentifier(identifier: string): string[] {
  const parts: string[] = []
  let current = ''
  let inBackticks = false

  for (let charIndex = 0; charIndex < identifier.length; charIndex++) {
    const char = identifier[charIndex]
    const isEscapedBacktick = char === '`' && inBackticks && identifier[charIndex + 1] === '`'
    if (isEscapedBacktick) {
      current += '``'
      charIndex++
      continue
    }
    if (char === '`') {
      current += char
      inBackticks = !inBackticks
      continue
    }
    const isPartSeparator = char === '.' && !inBackticks
    if (isPartSeparator) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)

  return parts.filter((part) => part.trim()).map(normalizeIdentifier)
}

const QUOTE_CHARACTERS = new Set(["'", '"', '`'])

const UNTERMINATED_COMMENT = -1

const SELECT_KEYWORD_PATTERN = /^SELECT\b/i

const FROM_KEYWORD_PATTERN = /^FROM\b/i

function isQuoteEscapeAt(text: string, index: number, quote: string): boolean {
  if (quote === '`') return text[index] === '`' && text[index + 1] === '`'
  return text[index] === '\\'
}

function findQuotedLiteralEnd(text: string, openIndex: number): number {
  const quote = text[openIndex]
  let index = openIndex + 1
  while (index < text.length) {
    if (isQuoteEscapeAt(text, index, quote)) {
      index += BACKTICK_PAIR_LENGTH
      continue
    }
    if (text[index] === quote) return index
    index++
  }
  return index
}

function blockCommentLastIndex(text: string, index: number): number {
  const closeIndex = text.indexOf('*/', index + COMMENT_MARKER_LENGTH)
  return closeIndex === -1 ? UNTERMINATED_COMMENT : closeIndex + 1
}

function commentEndIndex(text: string, index: number): number | null {
  if (text.startsWith('/*', index)) return blockCommentLastIndex(text, index)
  if (text.startsWith('--', index)) return text.indexOf('\n', index + COMMENT_MARKER_LENGTH)
  if (text[index] === '#') return text.indexOf('\n', index + 1)
  return null
}

function skipLiteralOrComment(text: string, index: number): number | null {
  if (QUOTE_CHARACTERS.has(text[index])) return findQuotedLiteralEnd(text, index)
  return commentEndIndex(text, index)
}

function nextParenDepth(depth: number, char: string): number {
  if (char === '(') return depth + 1
  if (char === ')') return Math.max(0, depth - 1)
  return depth
}

function findTopLevelKeyword(
  text: string,
  keywordPattern: RegExp,
  fromIndex: number
): number | null {
  let depth = 0
  for (let index = fromIndex; index < text.length; index++) {
    const skipEnd = skipLiteralOrComment(text, index)
    if (skipEnd === UNTERMINATED_COMMENT) return null
    if (skipEnd !== null) {
      index = skipEnd
      continue
    }
    depth = nextParenDepth(depth, text[index])
    const isTopLevelKeyword = depth === 0 && keywordPattern.test(text.slice(index))
    if (isTopLevelKeyword) return index
  }
  return null
}

export function extractTopLevelSelectList(sql: string): string | null {
  const trimmed = stripLeadingSqlComments(sql)
  const selectIndex = findTopLevelKeyword(trimmed, SELECT_KEYWORD_PATTERN, 0)
  if (selectIndex === null) return null
  const selectStart = selectIndex + SELECT_KEYWORD_LENGTH
  const fromIndex = findTopLevelKeyword(trimmed, FROM_KEYWORD_PATTERN, selectStart)
  if (fromIndex === null) return null
  return trimmed.slice(selectStart, fromIndex).trim()
}

export function splitTopLevelSelectItems(selectList: string): string[] {
  const items: string[] = []
  let current = ''
  let depth = 0

  for (let index = 0; index < selectList.length; index++) {
    const char = selectList[index]
    if (QUOTE_CHARACTERS.has(char)) {
      const literalEnd = findQuotedLiteralEnd(selectList, index)
      current += selectList.slice(index, literalEnd + 1)
      index = literalEnd
      continue
    }

    const commentEnd = commentEndIndex(selectList, index)
    if (commentEnd === UNTERMINATED_COMMENT) break
    if (commentEnd !== null) {
      index = commentEnd
      continue
    }

    current += char
    depth = nextParenDepth(depth, char)
    const isTopLevelComma = char === ',' && depth === 0
    if (isTopLevelComma) {
      items.push(current.slice(0, -1).trim())
      current = ''
    }
  }

  if (current.trim()) {
    items.push(current.trim())
  }

  return items.filter(Boolean)
}
