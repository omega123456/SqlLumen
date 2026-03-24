/**
 * Pure utility module for resolving table aliases in SQL statements.
 *
 * Builds a case-insensitive map from alias names to their resolved
 * { database, table } targets. Used by the completion service to
 * suggest columns when the user types "alias." after a FROM clause.
 *
 * No side effects, no store access — all data received as parameters.
 */

import type { EntityContext } from 'monaco-sql-languages'
import { EntityContextType } from 'monaco-sql-languages'
import { SQL_RESERVED_WORDS_SET } from './sql-keywords'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AliasResolution {
  database: string
  table: string
}

export type AliasMap = Map<string, AliasResolution> // lowercaseAlias -> { database, table }

// ---------------------------------------------------------------------------
// stripQuotes
// ---------------------------------------------------------------------------

/**
 * Removes surrounding backticks, single quotes, or double quotes from an
 * identifier string.  Only strips when the first and last characters are the
 * same quote character.
 *
 * Examples:
 *   stripQuotes('`users`')  => 'users'
 *   stripQuotes('"db"')     => 'db'
 *   stripQuotes("'table'")  => 'table'
 *   stripQuotes('users')    => 'users'
 */
export function stripQuotes(identifier: string): string {
  if (identifier.length < 2) return identifier
  const first = identifier[0]
  const last = identifier[identifier.length - 1]
  if (
    (first === '`' && last === '`') ||
    (first === '"' && last === '"') ||
    (first === "'" && last === "'")
  ) {
    return identifier.slice(1, -1)
  }
  return identifier
}

// ---------------------------------------------------------------------------
// parseTableRef — shared helper for qualified/unqualified table references
// ---------------------------------------------------------------------------

/**
 * Parse a raw table reference text (possibly qualified with a database prefix)
 * into a { database, table } pair.
 *
 * - Strips backticks/quotes from each part.
 * - Splits on `.`: if qualified, returns `{ database: parts[0], table: parts[last] }`.
 * - If unqualified and activeDatabase is non-null, returns
 *   `{ database: activeDatabase, table: strippedText }`.
 * - Returns `null` if unqualified and activeDatabase is null, or if the table
 *   name is empty after stripping.
 *
 * Each part is trimmed before stripping to handle whitespace around the dot
 * (e.g. `db . table`).
 */
function parseTableRef(rawText: string, activeDatabase: string | null): AliasResolution | null {
  if (rawText.includes('.')) {
    // Qualified: "db.table" or "`db`.`table`"
    const parts = rawText.split('.')
    const database = stripQuotes(parts[0].trim())
    const table = stripQuotes(parts[parts.length - 1].trim())
    if (!table) return null
    if (!database) return null
    return { database, table }
  } else {
    // Unqualified: "table" or "`table`"
    const table = stripQuotes(rawText.trim())
    if (!table) return null
    if (!activeDatabase) return null
    return { database: activeDatabase, table }
  }
}

// ---------------------------------------------------------------------------
// buildAliasMap
// ---------------------------------------------------------------------------

/**
 * Build a case-insensitive alias map from the entities collected by the
 * SQL parser.
 *
 * @param entities  Entity list from dt-sql-parser (may be null)
 * @param activeDatabase  The session's default database (may be null)
 * @returns Map from lowercase alias text to { database, table }
 */
export function buildAliasMap(
  entities: EntityContext[] | null,
  activeDatabase: string | null
): AliasMap {
  const map: AliasMap = new Map()

  if (!entities || entities.length === 0) return map

  // 1. Filter to TABLE entities that have an alias defined
  const aliased = entities.filter(
    (e) => e.entityContextType === EntityContextType.TABLE && e._alias
  )
  if (aliased.length === 0) return map

  // 2. Prefer entities in the statement containing the caret;
  //    fall back to all aliased entities if none have isContainCaret.
  const caretEntities = aliased.filter((e) => e.belongStmt?.isContainCaret)
  const working = caretEntities.length > 0 ? caretEntities : aliased

  // 3. Build the map
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

// ---------------------------------------------------------------------------
// buildAliasMapFromText
// ---------------------------------------------------------------------------

/**
 * Text-based fallback alias extraction.
 *
 * The dt-sql-parser only populates `allEntities` when it produces syntax
 * suggestions.  When the parser returns keywords-only (e.g. after `alias.`
 * in a WHERE clause), entities are null and entity-based alias resolution
 * fails.
 *
 * This function regex-parses FROM / JOIN clauses from the raw SQL text to
 * extract table-alias mappings.  It is intentionally conservative: it only
 * matches `FROM table alias` and `JOIN table alias` patterns, filtering
 * out SQL reserved words that could follow a table name.
 *
 * @param text           Full SQL text from the editor model
 * @param activeDatabase The session's default database (may be null)
 * @param caretOffset    When provided, only text before this offset is scanned.
 *                       This limits alias extraction to the current and preceding
 *                       context, avoiding aliases from statements after the caret.
 * @returns Map from lowercase alias text to { database, table }
 */
export function buildAliasMapFromText(
  text: string,
  activeDatabase: string | null,
  caretOffset?: number
): AliasMap {
  const map: AliasMap = new Map()
  if (!text) return map

  const effectiveText = caretOffset !== undefined ? text.substring(0, caretOffset) : text

  // Match FROM/JOIN followed by a table reference and an alias.
  // table_ref  = identifier  |  identifier.identifier
  // identifier = word chars | backtick/quote-quoted
  // alias      = optional AS keyword + identifier
  const pattern = /\b(?:FROM|JOIN)\s+([\w`"'.]+(?:\s*\.\s*[\w`"'.]+)?)\s+(?:AS\s+)?([\w`"]+)/gi

  let match
  while ((match = pattern.exec(effectiveText)) !== null) {
    const tablePart = match[1]
    const aliasPart = match[2]

    const aliasText = stripQuotes(aliasPart).toLowerCase()
    if (!aliasText) continue
    if (SQL_RESERVED_WORDS_SET.has(aliasText)) continue

    const resolved = parseTableRef(tablePart, activeDatabase)
    if (!resolved) continue

    map.set(aliasText, resolved)
  }

  return map
}
