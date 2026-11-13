export function withoutKey<TValue>(
  record: Record<string, TValue>,
  key: string
): Record<string, TValue> {
  const remaining = { ...record }
  delete remaining[key]
  return remaining
}
