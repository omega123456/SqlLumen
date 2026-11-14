import { format, parse, isValid, startOfToday } from 'date-fns'

export type TemporalColumnType = 'DATE' | 'DATETIME' | 'TIMESTAMP' | 'TIME' | null

const TEMPORAL_COLUMN_TYPES_BY_NAME = new Map<string, TemporalColumnType>([
  ['DATE', 'DATE'],
  ['DATETIME', 'DATETIME'],
  ['TIMESTAMP', 'TIMESTAMP'],
  ['TIME', 'TIME'],
])

const PARSE_REFERENCE_YEAR = 2000

interface TemporalConfig {
  format: string
  parseFormats: string[]
  dateFnsFormat: string
}

const DATETIME_CONFIG: TemporalConfig = {
  format: 'YYYY-MM-DD HH:mm:ss',
  parseFormats: ['yyyy-MM-dd HH:mm:ss', "yyyy-MM-dd'T'HH:mm:ss"],
  dateFnsFormat: 'yyyy-MM-dd HH:mm:ss',
}

export const TEMPORAL_CONFIGS: Record<NonNullable<TemporalColumnType>, TemporalConfig> = {
  DATE: {
    format: 'YYYY-MM-DD',
    parseFormats: ['yyyy-MM-dd'],
    dateFnsFormat: 'yyyy-MM-dd',
  },
  DATETIME: DATETIME_CONFIG,
  TIMESTAMP: DATETIME_CONFIG,
  TIME: {
    format: 'HH:mm:ss',
    parseFormats: ['HH:mm:ss'],
    dateFnsFormat: 'HH:mm:ss',
  },
}

export function getTemporalColumnType(dataType: string): TemporalColumnType {
  const normalized = dataType
    .trim()
    .toUpperCase()
    .replace(/\(\d+\)/, '')

  return TEMPORAL_COLUMN_TYPES_BY_NAME.get(normalized) ?? null
}

export function isTemporalColumn(dataType: string): boolean {
  return getTemporalColumnType(dataType) !== null
}

const ZERO_DATE_PATTERNS = [
  '0000-00-00',
  '0000-00-00 00:00:00',
  '0000-00-00T00:00:00',
  '0000-00-00 00:00:00.000000',
  '0000-00-00 00:00:00.000',
]

export function isZeroDate(value: string): boolean {
  if (!value) return false
  const trimmed = value.trim()
  return ZERO_DATE_PATTERNS.includes(trimmed) || /^0{4}-0{2}-0{2}/.test(trimmed)
}

export function getMysqlFormatString(type: TemporalColumnType): string {
  if (type === null) return TEMPORAL_CONFIGS.DATETIME.dateFnsFormat
  return TEMPORAL_CONFIGS[type].dateFnsFormat
}

function isEmptyTemporalValue(value: string | null | undefined): value is null | undefined | '' {
  return value === null || value === undefined || value === ''
}

function isZeroCalendarDate(value: string, type: TemporalColumnType): boolean {
  return type !== 'TIME' && isZeroDate(value)
}

export function parseMysqlDate(value: string | null, type: TemporalColumnType): Date | null {
  if (isEmptyTemporalValue(value)) return null
  if (isZeroCalendarDate(value, type)) return null

  const config = type !== null ? TEMPORAL_CONFIGS[type] : TEMPORAL_CONFIGS.DATETIME
  const referenceDate = new Date(PARSE_REFERENCE_YEAR, 0, 1)

  const cleaned = value.trim().replace(/\.\d+$/, '')

  for (const parseFormat of config.parseFormats) {
    const parsed = parse(cleaned, parseFormat, referenceDate)
    if (isValid(parsed)) return parsed
  }

  return null
}

export function formatMysqlDate(date: Date | null, type: TemporalColumnType): string | null {
  if (date === null) return null
  if (!isValid(date)) return null

  const formatPattern = getMysqlFormatString(type)
  return format(date, formatPattern)
}

export function validateTemporalValue(
  value: string | null | undefined,
  type: TemporalColumnType
): string | null {
  if (isEmptyTemporalValue(value)) return null
  if (isZeroCalendarDate(value, type)) return null

  const parsed = parseMysqlDate(value, type)
  if (parsed === null) {
    const formatPattern = type ? TEMPORAL_CONFIGS[type].format : 'YYYY-MM-DD HH:mm:ss'
    return `Invalid ${type ?? 'date'} value. Expected format: ${formatPattern}`
  }
  return null
}

export function getTodayMysqlString(type: TemporalColumnType): string {
  const now = new Date()
  if (type === null) return format(now, TEMPORAL_CONFIGS.DATETIME.dateFnsFormat)

  const config = TEMPORAL_CONFIGS[type]
  const base = type === 'DATE' ? startOfToday() : now
  return format(base, config.dateFnsFormat)
}
