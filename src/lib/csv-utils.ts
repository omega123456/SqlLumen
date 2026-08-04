function csvValue(value: unknown): string {
  if (value == null) return ''

  const text =
    typeof value === 'boolean'
      ? value
        ? '1'
        : '0'
      : typeof value === 'object'
        ? (JSON.stringify(value) ?? '')
        : String(value)

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function serializeCsv(
  columns: readonly string[],
  rows: readonly (readonly unknown[])[]
): string {
  return [columns, ...rows].map((row) => row.map(csvValue).join(',')).join('\r\n') + '\r\n'
}
