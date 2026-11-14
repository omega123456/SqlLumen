import type { EntityContext } from 'monaco-sql-languages'
import { EntityContextType } from 'monaco-sql-languages'
import { SQL_RESERVED_WORDS_SET } from './sql-keywords'

const QUOTE_PAIR_LENGTH = 2
const IDENTIFIER_QUOTES: ReadonlySet<string> = new Set(['`', '"', "'"])

export interface AliasResolution {
  database: string
  table: string
}

export type AliasMap = Map<string, AliasResolution>

export function stripQuotes(identifier: string): string {
  if (identifier.length < QUOTE_PAIR_LENGTH) return identifier
  const first = identifier[0]
  const last = identifier[identifier.length - 1]
  const isQuoted = first === last && IDENTIFIER_QUOTES.has(first)
  if (isQuoted) {
    return identifier.slice(1, -1)
  }
  return identifier
}

function parseTableRef(rawText: string, activeDatabase: string | null): AliasResolution | null {
  if (!rawText.includes('.')) {
    const table = stripQuotes(rawText.trim())
    if (!table) return null
    if (!activeDatabase) return null
    return { database: activeDatabase, table: table }
  }
  const parts = rawText.split('.')
  const database = stripQuotes(parts[0].trim())
  const table = stripQuotes(parts[parts.length - 1].trim())
  if (!table) return null
  if (!database) return null
  return { database, table }
}

function isWrappedIn(text: string, quote: string): boolean {
  return text.startsWith(quote) && text.endsWith(quote)
}

function isQuotedIdentifier(text: string): boolean {
  if (text.length < QUOTE_PAIR_LENGTH) return false
  return isWrappedIn(text, '`') || isWrappedIn(text, '"')
}

function aliasTextFromMatch(aliasPart: string): string | null {
  const aliasText = stripQuotes(aliasPart).toLowerCase()
  if (!aliasText) return null
  const isReservedWord = !isQuotedIdentifier(aliasPart) && SQL_RESERVED_WORDS_SET.has(aliasText)
  if (isReservedWord) return null
  return aliasText
}

export function buildAliasMap(
  entities: EntityContext[] | null,
  activeDatabase: string | null
): AliasMap {
  const map: AliasMap = new Map()

  if (!entities) return map
  if (entities.length === 0) return map

  const aliased = entities.filter(
    (entity) => entity.entityContextType === EntityContextType.TABLE && entity._alias
  )
  if (aliased.length === 0) return map

  const caretEntities = aliased.filter((entity) => entity.belongStmt?.isContainCaret)
  const working = caretEntities.length > 0 ? caretEntities : aliased

  for (const entity of working) {
    const alias = entity._alias
    if (!alias) continue

    const aliasText = stripQuotes(alias.text).toLowerCase()
    if (!aliasText) continue

    const text = entity.text
    if (!text) continue

    const resolved = parseTableRef(text, activeDatabase)
    if (!resolved) continue

    map.set(aliasText, resolved)
  }

  return map
}

export function buildAliasMapFromText(
  text: string,
  activeDatabase: string | null,
  caretOffset?: number
): AliasMap {
  const map: AliasMap = new Map()
  if (!text) return map

  const effectiveText = text.substring(0, caretOffset ?? text.length)

  const pattern = /\b(?:FROM|JOIN)\s+([\w`"'.]+(?:\s*\.\s*[\w`"'.]+)?)\s+(?:AS\s+)?([\w`"]+)/gi

  let match
  while ((match = pattern.exec(effectiveText)) !== null) {
    const tablePart = match[1]
    const aliasText = aliasTextFromMatch(match[2])
    if (!aliasText) continue

    const resolved = parseTableRef(tablePart, activeDatabase)
    if (!resolved) continue

    map.set(aliasText, resolved)
  }

  return map
}
