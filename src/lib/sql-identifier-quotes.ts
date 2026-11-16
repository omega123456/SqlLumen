export const QUOTE_PAIR_LENGTH = 2
const IDENTIFIER_QUOTES: ReadonlySet<string> = new Set(['`', '"', "'"])

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
