import { logFrontend } from '../../lib/app-log-commands'
import { DATABASE_AND_TABLE_PART_COUNT } from './retrieval-hints'

export const QUERY_EXPANSION_SYSTEM_PROMPT = `You are a SQL schema search assistant. Given a user's natural language question about a database, generate search queries and analysis to find the most relevant database tables. Output strictly as JSON with no explanation.

When table names are mentioned or implied, prefer database-qualified names when possible so retrieval preserves the database prefix.

Required JSON format:
{
  "queries": ["...", "...", "..."],
  "hypotheticalSql": "SELECT ... FROM \`db\`.\`table\` ...",
  "entities": ["table1", "table2"],
  "joins": ["table1 → table2"],
  "metrics": ["revenue", "count"]
}

Fields:
- queries: 2–3 short search phrases using SQL vocabulary (table names, column names, SQL keywords, JOIN patterns)
- hypotheticalSql: A hypothetical SQL fragment that would answer the question (used for embedding search, not execution)
- entities: Table/object names referenced or implied
- joins: Relationships between entities (use → notation)
- metrics: Aggregation metrics or computed values referenced

Examples:
User: "Show me all customers who haven't ordered anything in the last 6 months"
Output: {"queries":["customers orders LEFT JOIN last_order_date","customers table id name email","orders customer_id created_at date"],"hypotheticalSql":"SELECT c.* FROM \`db\`.\`customers\` c LEFT JOIN \`db\`.\`orders\` o ON c.id = o.customer_id WHERE o.created_at < DATE_SUB(NOW(), INTERVAL 6 MONTH) OR o.id IS NULL","entities":["customers","orders"],"joins":["customers → orders"],"metrics":["count"]}

User: "What's the total revenue by product category?"
Output: {"queries":["products categories revenue SUM price","product_categories category_name JOIN products","orders order_items products price quantity amount"],"hypotheticalSql":"SELECT pc.name, SUM(oi.price * oi.quantity) as revenue FROM \`db\`.\`product_categories\` pc JOIN \`db\`.\`products\` p ON pc.id = p.category_id JOIN \`db\`.\`order_items\` oi ON p.id = oi.product_id GROUP BY pc.name","entities":["products","product_categories","order_items","orders"],"joins":["product_categories → products","products → order_items"],"metrics":["revenue","sum","price","quantity"]}`

const TABLE_NAME_REGEX =
  /(?:from|join|into|update|table|references)\s+((?:`[^`]+`|[a-z_]\w*)(?:\.(?:`[^`]+`|[a-z_]\w*))?)/gi

function splitQualifiedTableName(qualifiedName: string): { dbName: string; tableName: string } {
  const parts = qualifiedName.split('.').map((part) => part.replace(/`/g, '').trim())
  if (parts.length === DATABASE_AND_TABLE_PART_COUNT) {
    return { dbName: parts[0], tableName: parts[1] }
  }
  if (parts.length === 1) {
    return { dbName: '', tableName: parts[0] }
  }
  return { dbName: '', tableName: '' }
}

export function extractTablesFromSql(sql: string): Array<{ dbName: string; tableName: string }> {
  const results: Array<{ dbName: string; tableName: string }> = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null
  TABLE_NAME_REGEX.lastIndex = 0
  while ((match = TABLE_NAME_REGEX.exec(sql)) !== null) {
    const { dbName, tableName } = splitQualifiedTableName(match[1])
    if (!tableName) continue
    const key = `${dbName}.${tableName}`.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      results.push({ dbName, tableName })
    }
  }
  return results
}

export interface ExpansionParseOptions {
  userMessage: string
  hydeEnabled: boolean
  maxQueries: number
}

interface ExpansionParse {
  queries: string[]
  isCacheable: boolean
}

const RECOGNISED_EXPANSION_FIELDS = ['queries', 'hypotheticalSql', 'entities', 'joins', 'metrics']

function fallbackExpansion(userMessage: string, reason: string): ExpansionParse {
  logFrontend('debug', `[ai-store] ${reason} — falling back to original query`)
  return {
    queries: [userMessage],
    isCacheable: false,
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && !Array.isArray(value) && typeof value === 'object'
}

function hasRecognisedExpansionField(payload: Record<string, unknown>): boolean {
  return RECOGNISED_EXPANSION_FIELDS.some((field) => field in payload)
}

function appendTrimmedQuery(queries: string[], value: unknown): void {
  if (typeof value !== 'string') return
  const trimmed = value.trim()
  if (trimmed.length > 0) {
    queries.push(trimmed)
  }
}

function appendJoinedField(queries: string[], value: unknown): void {
  if (!Array.isArray(value)) return
  const joined = value
    .filter((item: unknown): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .join(' ')
  if (joined.length > 0) {
    queries.push(joined)
  }
}

function collectExpansionQueries(
  payload: Record<string, unknown>,
  options: ExpansionParseOptions
): string[] {
  const allQueries: string[] = [options.userMessage]
  const listedQueries: unknown[] = Array.isArray(payload.queries) ? payload.queries : []
  for (const query of listedQueries) {
    appendTrimmedQuery(allQueries, query)
  }
  if (options.hydeEnabled) {
    appendTrimmedQuery(allQueries, payload.hypotheticalSql)
  }
  appendJoinedField(allQueries, payload.entities)
  appendJoinedField(allQueries, payload.joins)
  appendJoinedField(allQueries, payload.metrics)
  return Array.from(new Set(allQueries)).slice(0, options.maxQueries)
}

function isDifferentTrimmedText(text: string, trimmedReference: string): boolean {
  return text.trim() !== trimmedReference
}

function hasDerivedExpansion(queries: string[], userMessage: string): boolean {
  const trimmedUserMessage = userMessage.trim()
  return queries.some((query) => isDifferentTrimmedText(query, trimmedUserMessage))
}

export function parseExpansionResponse(
  text: string,
  options: ExpansionParseOptions
): ExpansionParse {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return fallbackExpansion(options.userMessage, 'expansion response JSON parse failed')
  }
  if (!isJsonObject(parsed)) {
    return fallbackExpansion(options.userMessage, 'expansion response had invalid JSON shape')
  }
  if (!hasRecognisedExpansionField(parsed)) {
    return fallbackExpansion(options.userMessage, 'expansion response missing structured fields')
  }
  const dedupedQueries = collectExpansionQueries(parsed, options)
  if (!hasDerivedExpansion(dedupedQueries, options.userMessage)) {
    return fallbackExpansion(
      options.userMessage,
      'expansion response produced no usable derived queries'
    )
  }
  return {
    queries: dedupedQueries,
    isCacheable: true,
  }
}
