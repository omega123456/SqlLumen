export type MySQLTypeGroup = 'Numeric' | 'String' | 'Date & Time' | 'Spatial' | 'JSON'

export interface MySQLTypeInfo {
  name: string
  group: MySQLTypeGroup
  supportsLength: boolean
  isNumeric: boolean
}

export const MYSQL_TYPES: MySQLTypeInfo[] = [
  { name: 'INT', group: 'Numeric', supportsLength: true, isNumeric: true },
  { name: 'TINYINT', group: 'Numeric', supportsLength: true, isNumeric: true },
  { name: 'SMALLINT', group: 'Numeric', supportsLength: true, isNumeric: true },
  { name: 'MEDIUMINT', group: 'Numeric', supportsLength: true, isNumeric: true },
  { name: 'BIGINT', group: 'Numeric', supportsLength: true, isNumeric: true },
  { name: 'DECIMAL', group: 'Numeric', supportsLength: true, isNumeric: true },
  { name: 'FLOAT', group: 'Numeric', supportsLength: true, isNumeric: true },
  { name: 'DOUBLE', group: 'Numeric', supportsLength: true, isNumeric: true },
  { name: 'BIT', group: 'Numeric', supportsLength: true, isNumeric: true },
  { name: 'BOOLEAN', group: 'Numeric', supportsLength: false, isNumeric: true },
  { name: 'VARCHAR', group: 'String', supportsLength: true, isNumeric: false },
  { name: 'CHAR', group: 'String', supportsLength: true, isNumeric: false },
  { name: 'TEXT', group: 'String', supportsLength: false, isNumeric: false },
  { name: 'TINYTEXT', group: 'String', supportsLength: false, isNumeric: false },
  { name: 'MEDIUMTEXT', group: 'String', supportsLength: false, isNumeric: false },
  { name: 'LONGTEXT', group: 'String', supportsLength: false, isNumeric: false },
  { name: 'BINARY', group: 'String', supportsLength: true, isNumeric: false },
  { name: 'VARBINARY', group: 'String', supportsLength: true, isNumeric: false },
  { name: 'BLOB', group: 'String', supportsLength: false, isNumeric: false },
  { name: 'TINYBLOB', group: 'String', supportsLength: false, isNumeric: false },
  { name: 'MEDIUMBLOB', group: 'String', supportsLength: false, isNumeric: false },
  { name: 'LONGBLOB', group: 'String', supportsLength: false, isNumeric: false },
  { name: 'ENUM', group: 'String', supportsLength: true, isNumeric: false },
  { name: 'SET', group: 'String', supportsLength: true, isNumeric: false },
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
