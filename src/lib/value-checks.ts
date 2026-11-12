export function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

export function isBlank(text: string): boolean {
  return text.trim().length === 0
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function isIndexInBounds(index: number, length: number): boolean {
  return index >= 0 && index < length
}

export function isPresentIndex(index: number | null | undefined): index is number {
  if (isNullish(index)) return false
  return index >= 0
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isPositiveFiniteNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0
}
