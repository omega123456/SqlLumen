import {
  IDENTIFIER_CHARACTER,
  NOT_FOUND,
  PAREN_DEPTH_CHANGE_BACKWARD,
  PAREN_DEPTH_CHANGE_FORWARD,
  QUOTED_IDENTIFIER_CHARACTERS,
  canScanBackwardTo,
  isIdentifierCharacterAt,
  lineCommentJumpTarget,
  skipBackwardWhitespaceAndComments,
  skipNonCodeBackward,
  skipNonCodeForward,
} from './sql-text-scan'

const CALL_KEYWORD = 'CALL'

function readIdentifierBackward(
  text: string,
  position: number
): { name: string; end: number } | null {
  if (position < 0) return null
  const character = text[position]

  if (QUOTED_IDENTIFIER_CHARACTERS.has(character)) {
    const quote = character
    let start = position - 1
    while (canScanBackwardTo(text, start, quote)) start--
    if (start < 0) return null
    return { name: text.slice(start + 1, position), end: start - 1 }
  }

  if (IDENTIFIER_CHARACTER.test(character)) {
    let start = position
    while (isIdentifierCharacterAt(text, start - 1)) start--
    return { name: text.slice(start, position + 1), end: start - 1 }
  }

  return null
}

function countActiveParameter(
  text: string,
  openParenPosition: number,
  cursorPosition: number
): number {
  let activeParameter = 0
  let depth = 0
  for (let scanIndex = openParenPosition + 1; scanIndex < cursorPosition; scanIndex++) {
    const skippedTo = skipNonCodeForward(text, scanIndex, cursorPosition)
    if (skippedTo !== null) {
      scanIndex = skippedTo
      continue
    }
    const character = text[scanIndex]
    depth += PAREN_DEPTH_CHANGE_FORWARD[character] ?? 0
    const isTopLevelComma = character === ',' && depth === 0
    if (isTopLevelComma) activeParameter++
  }
  return activeParameter
}

function findEnclosingOpenParen(text: string, cursorOffset: number): number {
  let depth = 0
  let scanIndex = cursorOffset - 1
  let needLineCommentCheck = true

  while (scanIndex >= 0) {
    const commentJump = needLineCommentCheck ? lineCommentJumpTarget(text, scanIndex) : null
    if (commentJump !== null) {
      scanIndex = commentJump
      continue
    }
    needLineCommentCheck = false

    const literalStart = skipNonCodeBackward(text, scanIndex)
    if (literalStart !== null) {
      scanIndex = literalStart - 1
      needLineCommentCheck = true
      continue
    }

    const character = text[scanIndex]
    const isOpeningParenthesis = character === '(' && depth === 0
    if (isOpeningParenthesis) return scanIndex
    depth += PAREN_DEPTH_CHANGE_BACKWARD[character] ?? 0
    if (character === '\n') needLineCommentCheck = true
    scanIndex--
  }
  return NOT_FOUND
}

interface QualifiedFunctionName {
  functionName: string
  database: string | null
  positionBeforeName: number
}

function readDatabaseQualifier(
  text: string,
  nameEnd: number
): { database: string | null; positionBeforeName: number } {
  const positionBeforeName = skipBackwardWhitespaceAndComments(text, nameEnd)
  if (text[positionBeforeName] !== '.') {
    return { database: null, positionBeforeName: nameEnd }
  }
  const qualifierEnd = skipBackwardWhitespaceAndComments(text, positionBeforeName - 1)
  const qualifier = readIdentifierBackward(text, qualifierEnd)
  if (!qualifier) return { database: null, positionBeforeName: qualifierEnd }
  return { database: qualifier.name, positionBeforeName: qualifier.end }
}

function readQualifiedFunctionName(
  text: string,
  openParenPosition: number
): QualifiedFunctionName | null {
  const nameEnd = skipBackwardWhitespaceAndComments(text, openParenPosition - 1)
  if (nameEnd < 0) return null
  const identifier = readIdentifierBackward(text, nameEnd)
  if (!identifier?.name) return null
  const qualifier = readDatabaseQualifier(text, identifier.end)
  return {
    functionName: identifier.name,
    database: qualifier.database,
    positionBeforeName: qualifier.positionBeforeName,
  }
}

function isPrecededByCallKeyword(text: string, position: number): boolean {
  const checkPosition = skipBackwardWhitespaceAndComments(text, position)
  const keywordStart = checkPosition - CALL_KEYWORD.length + 1
  if (keywordStart < 0) return false
  const precedingWord = text.slice(keywordStart, checkPosition + 1).toUpperCase()
  if (precedingWord !== CALL_KEYWORD) return false
  return keywordStart === 0 || !IDENTIFIER_CHARACTER.test(text[keywordStart - 1])
}

export function _parseFunctionContext(
  statementText: string,
  cursorOffset: number
): {
  functionName: string
  database: string | null
  activeParameter: number
  isCall: boolean
} | null {
  const openParenPosition = findEnclosingOpenParen(statementText, cursorOffset)
  if (openParenPosition < 0) return null
  const name = readQualifiedFunctionName(statementText, openParenPosition)
  if (!name) return null
  return {
    functionName: name.functionName,
    database: name.database,
    activeParameter: countActiveParameter(statementText, openParenPosition, cursorOffset),
    isCall: isPrecededByCallKeyword(statementText, name.positionBeforeName),
  }
}
