function csvValue(value: unknown): string {
  if (value == null) return ''

  const text = csvCellText(value)

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csvCellText(value: unknown): string {
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'object') return JSON.stringify(value) ?? ''
  return String(value)
}

export function serializeCsv(
  columns: readonly string[],
  rows: readonly (readonly unknown[])[]
): string {
  return [columns, ...rows].map((row) => row.map(csvValue).join(',')).join('\r\n') + '\r\n'
}
