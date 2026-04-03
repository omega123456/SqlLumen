export type MySQLTypeGroup = 'Numeric' | 'String' | 'Date & Time' | 'Spatial' | 'JSON'

export interface MySQLTypeInfo {
  name: string
  group: MySQLTypeGroup
  supportsLength: boolean
  isNumeric: boolean
  defaultLength?: string
  maxLength?: number
  supportsSignedness?: boolean
  modifierTokens?: readonly string[]
}

export const MYSQL_TYPES: MySQLTypeInfo[] = [
  {
    name: 'INT',
    group: 'Numeric',
    supportsLength: true,
    isNumeric: true,
    defaultLength: '11',
    maxLength: 11,
    supportsSignedness: true,
    modifierTokens: ['UNSIGNED', 'ZEROFILL'],
  },
  {
    name: 'TINYINT',
    group: 'Numeric',
    supportsLength: true,
    isNumeric: true,
    defaultLength: '4',
    maxLength: 4,
    supportsSignedness: true,
    modifierTokens: ['UNSIGNED', 'ZEROFILL'],
  },
  {
    name: 'SMALLINT',
    group: 'Numeric',
    supportsLength: true,
    isNumeric: true,
    defaultLength: '6',
    maxLength: 6,
    supportsSignedness: true,
    modifierTokens: ['UNSIGNED', 'ZEROFILL'],
  },
  {
    name: 'MEDIUMINT',
    group: 'Numeric',
    supportsLength: true,
    isNumeric: true,
    defaultLength: '9',
    maxLength: 9,
    supportsSignedness: true,
    modifierTokens: ['UNSIGNED', 'ZEROFILL'],
  },
  {
    name: 'BIGINT',
    group: 'Numeric',
    supportsLength: true,
    isNumeric: true,
    defaultLength: '20',
    maxLength: 20,
    supportsSignedness: true,
    modifierTokens: ['UNSIGNED', 'ZEROFILL'],
  },
  {
    name: 'DECIMAL',
    group: 'Numeric',
    supportsLength: true,
    isNumeric: true,
    defaultLength: '10,0',
    supportsSignedness: true,
    modifierTokens: ['UNSIGNED', 'ZEROFILL'],
  },
  {
    name: 'FLOAT',
    group: 'Numeric',
    supportsLength: true,
    isNumeric: true,
    defaultLength: '12',
    supportsSignedness: true,
    modifierTokens: ['UNSIGNED', 'ZEROFILL'],
  },
  {
    name: 'DOUBLE',
    group: 'Numeric',
    supportsLength: true,
    isNumeric: true,
    defaultLength: '22',
    supportsSignedness: true,
    modifierTokens: ['UNSIGNED', 'ZEROFILL'],
  },
  {
    name: 'BIT',
    group: 'Numeric',
    supportsLength: true,
    isNumeric: true,
    defaultLength: '1',
    maxLength: 64,
    supportsSignedness: false,
  },
  { name: 'BOOLEAN', group: 'Numeric', supportsLength: false, isNumeric: true },
  {
    name: 'VARCHAR',
    group: 'String',
    supportsLength: true,
    isNumeric: false,
    defaultLength: '255',
    maxLength: 65535,
  },
  {
    name: 'CHAR',
    group: 'String',
    supportsLength: true,
    isNumeric: false,
    defaultLength: '1',
    maxLength: 255,
    modifierTokens: ['BINARY'],
  },
  { name: 'TEXT', group: 'String', supportsLength: false, isNumeric: false },
  { name: 'TINYTEXT', group: 'String', supportsLength: false, isNumeric: false },
  { name: 'MEDIUMTEXT', group: 'String', supportsLength: false, isNumeric: false },
  { name: 'LONGTEXT', group: 'String', supportsLength: false, isNumeric: false },
  {
    name: 'BINARY',
    group: 'String',
    supportsLength: true,
    isNumeric: false,
    defaultLength: '1',
    maxLength: 255,
  },
  {
    name: 'VARBINARY',
    group: 'String',
    supportsLength: true,
    isNumeric: false,
    defaultLength: '255',
    maxLength: 65535,
  },
  { name: 'BLOB', group: 'String', supportsLength: false, isNumeric: false },
  { name: 'TINYBLOB', group: 'String', supportsLength: false, isNumeric: false },
  { name: 'MEDIUMBLOB', group: 'String', supportsLength: false, isNumeric: false },
  { name: 'LONGBLOB', group: 'String', supportsLength: false, isNumeric: false },
  { name: 'ENUM', group: 'String', supportsLength: true, isNumeric: false, defaultLength: '' },
  { name: 'SET', group: 'String', supportsLength: true, isNumeric: false, defaultLength: '' },
  { name: 'DATE', group: 'Date & Time', supportsLength: false, isNumeric: false },
  { name: 'TIME', group: 'Date & Time', supportsLength: false, isNumeric: false },
  { name: 'DATETIME', group: 'Date & Time', supportsLength: false, isNumeric: false },
  { name: 'TIMESTAMP', group: 'Date & Time', supportsLength: false, isNumeric: false },
  { name: 'YEAR', group: 'Date & Time', supportsLength: false, isNumeric: false },
  { name: 'GEOMETRY', group: 'Spatial', supportsLength: false, isNumeric: false },
  { name: 'POINT', group: 'Spatial', supportsLength: false, isNumeric: false },
  { name: 'LINESTRING', group: 'Spatial', supportsLength: false, isNumeric: false },
  { name: 'POLYGON', group: 'Spatial', supportsLength: false, isNumeric: false },
  { name: 'MULTIPOINT', group: 'Spatial', supportsLength: false, isNumeric: false },
  { name: 'MULTILINESTRING', group: 'Spatial', supportsLength: false, isNumeric: false },
  { name: 'MULTIPOLYGON', group: 'Spatial', supportsLength: false, isNumeric: false },
  { name: 'GEOMETRYCOLLECTION', group: 'Spatial', supportsLength: false, isNumeric: false },
  { name: 'JSON', group: 'JSON', supportsLength: false, isNumeric: false },
]

const MYSQL_TYPE_GROUP_ORDER: readonly MySQLTypeGroup[] = [
  'Numeric',
  'String',
  'Date & Time',
  'Spatial',
  'JSON',
]

const MYSQL_TYPE_INFO_BY_NAME = new Map(MYSQL_TYPES.map((type) => [type.name, type]))

function normalizeTypeName(type: string): string {
  return type.trim().toUpperCase()
}

function getMySqlTypeInfo(type: string): MySQLTypeInfo | undefined {
  return MYSQL_TYPE_INFO_BY_NAME.get(normalizeTypeName(type))
}

export const TYPES_WITHOUT_LENGTH: readonly string[] = MYSQL_TYPES.filter(
  (type) => !type.supportsLength
).map((type) => type.name)

export const NUMERIC_TYPES: readonly string[] = MYSQL_TYPES.filter((type) => type.isNumeric).map(
  (type) => type.name
)

export const MYSQL_TYPE_GROUPS: { label: MySQLTypeGroup; types: string[] }[] =
  MYSQL_TYPE_GROUP_ORDER.map((group) => ({
    label: group,
    types: MYSQL_TYPES.filter((type) => type.group === group).map((type) => type.name),
  }))

export function getDefaultLengthForType(type: string): string {
  const info = getMySqlTypeInfo(type)
  if (!info?.supportsLength) {
    return ''
  }

  return info.defaultLength ?? ''
}

export function clampLengthForType(type: string, length: string): string {
  const info = getMySqlTypeInfo(type)
  if (!info?.supportsLength) {
    return ''
  }

  const trimmed = length.trim()
  if (trimmed === '') {
    return ''
  }

  if (!/^\d+$/.test(trimmed) || info.maxLength === undefined) {
    return trimmed
  }

  return String(Math.min(Number.parseInt(trimmed, 10), info.maxLength))
}

export function supportsSignedness(type: string): boolean {
  return getMySqlTypeInfo(type)?.supportsSignedness ?? false
}

function normalizeModifierTokens(modifier: string | null | undefined): string[] {
  return (modifier ?? '').trim().toUpperCase().split(/\s+/).filter(Boolean)
}

function supportedModifierTokensForType(type: string): Set<string> {
  return new Set(getMySqlTypeInfo(type)?.modifierTokens ?? [])
}

export function preserveSupportedTypeModifier(
  type: string,
  modifier: string | null | undefined
): string {
  const supportedTokens = supportedModifierTokensForType(type)
  if (supportedTokens.size === 0) {
    return ''
  }

  const preserved = normalizeModifierTokens(modifier).filter((token) => supportedTokens.has(token))
  return preserved.join(' ')
}

export function normalizeTypeModifier(type: string, modifier: string | null | undefined): string {
  return preserveSupportedTypeModifier(type, modifier)
}

export function getSignednessValue(
  type: string,
  modifier: string | null | undefined
): 'SIGNED' | 'UNSIGNED' {
  return normalizeModifierTokens(normalizeTypeModifier(type, modifier)).includes('UNSIGNED')
    ? 'UNSIGNED'
    : 'SIGNED'
}
